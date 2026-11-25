// `exclusively` (e2e-lock.ts) is the lock Playwright's workers share.
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { exclusively } from './e2e-lock.ts'

const LOCK_MODULE = path.join(import.meta.dirname, 'e2e-lock.ts')
let dir: string
let previousDatabasePath: string | undefined

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-lock-'))
	previousDatabasePath = process.env.DATABASE_PATH
	// The lock lives beside the test database.
	process.env.DATABASE_PATH = path.join(dir, 'e2e.db')
})

afterEach(async () => {
	if (previousDatabasePath === undefined) {
		Reflect.deleteProperty(process.env, 'DATABASE_PATH')
	} else {
		process.env.DATABASE_PATH = previousDatabasePath
	}
	await fs.rm(dir, { recursive: true, force: true })
})

/**
 * Another process that takes the lock, prints "held", holds it for
 * `holdMs` (or until it is killed), then prints "done <time>" as its last
 * act before giving the lock up.
 */
function holderProcess(holdMs: number) {
	const child = spawn(
		'bun',
		[
			'-e',
			`const { exclusively } = await import(${JSON.stringify(LOCK_MODULE)})
await exclusively('shared', async () => {
	console.log('held')
	await new Promise((resolve) => setTimeout(resolve, ${holdMs}))
	console.log('done ' + Date.now())
})`,
		],
		{
			env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH },
			stdio: ['ignore', 'pipe', 'inherit'],
		},
	)
	const lines: string[] = []
	const said = (prefix: string) =>
		new Promise<string>((resolve, reject) => {
			const check = () => {
				const line = lines.find((l) => l.startsWith(prefix))
				if (line) resolve(line)
			}
			child.stdout.on('data', (chunk: Buffer) => {
				lines.push(...chunk.toString().split('\n').filter(Boolean))
				check()
			})
			child.on('exit', () => {
				check()
				reject(new Error(`holder exited without saying ${prefix}`))
			})
		})
	const held = said('held')
	// When it gave the lock up, by its clock, which is this machine's.
	const done = said('done').then((line) => Number(line.split(' ')[1]))
	done.catch(() => {})
	const exited = new Promise((resolve) => child.on('exit', resolve))
	return { child, held, done, exited }
}

function counter() {
	let active = 0
	let most = 0
	let runs = 0
	return {
		async work() {
			active++
			runs++
			most = Math.max(most, active)
			await new Promise((resolve) =>
				setTimeout(resolve, 5 + Math.random() * 15),
			)
			active--
		},
		get most() {
			return most
		},
		get runs() {
			return runs
		},
	}
}

// Waiting for a fixed "stale" age, longer than a test's timeout, would fail
// every later test.
test('a lock whose holder died is passed at once', async () => {
	const holder = holderProcess(60_000)
	await holder.held
	holder.child.kill('SIGKILL')
	await holder.exited

	const started = Date.now()
	await exclusively('shared', async () => {})

	expect(Date.now() - started).toBeLessThan(2_000)
}, 15_000)

test('waiters that find a dead holder together still take turns', async () => {
	const holder = holderProcess(60_000)
	await holder.held
	holder.child.kill('SIGKILL')
	await holder.exited
	const count = counter()

	await Promise.all(
		Array.from({ length: 8 }, () => exclusively('shared', count.work)),
	)

	expect(count.runs).toBe(8)
	expect(count.most).toBe(1)
}, 15_000)

test("a live holder in another process isn't taken for dead", async () => {
	const holder = holderProcess(800)
	await holder.held

	let startedAt = 0
	await exclusively('shared', async () => {
		startedAt = Date.now()
	})

	expect(startedAt).toBeGreaterThanOrEqual(await holder.done)
}, 15_000)

test('work that throws gives the lock up', async () => {
	await expect(
		exclusively('shared', async () => {
			throw new Error('the test failed')
		}),
	).rejects.toThrow('the test failed')

	const started = Date.now()
	await exclusively('shared', async () => {})
	expect(Date.now() - started).toBeLessThan(1_000)
})
