import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { get } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { SHUTDOWN_GRACE_PERIOD_MS } from './shutdown.ts'

const flyConfig = readFileSync(new URL('../fly.toml', import.meta.url), 'utf8')
const killTimeoutMatch = flyConfig.match(/^kill_timeout\s*=\s*(\d+)/m)
if (!killTimeoutMatch) throw new Error('fly.toml must configure kill_timeout')
const FLY_KILL_TIMEOUT_MS = Number(killTimeoutMatch[1]) * 1_000
const TEST_DEADLINE_MS = SHUTDOWN_GRACE_PERIOD_MS + 500

let child: ChildProcessWithoutNullStreams | undefined

afterEach(() => {
	if (child && child.exitCode === null) child.kill('SIGKILL')
	child = undefined
})

function waitForOutput(
	process: ChildProcessWithoutNullStreams,
	pattern: RegExp,
) {
	return new Promise<RegExpMatchArray>((resolve, reject) => {
		let output = ''
		const onData = (chunk: Buffer) => {
			output += chunk.toString()
			const match = output.match(pattern)
			if (match) {
				process.stdout.off('data', onData)
				resolve(match)
			}
		}
		process.stdout.on('data', onData)
		process.once('exit', (code, signal) => {
			reject(
				new Error(
					`Child exited before ${pattern}: code=${code} signal=${signal}; output=${output}`,
				),
			)
		})
	})
}

function waitForExit(process: ChildProcessWithoutNullStreams) {
	return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
		(resolve) => {
			process.once('exit', (code, signal) => resolve({ code, signal }))
		},
	)
}

describe('graceful shutdown', () => {
	test('application grace period fits inside the platform kill window', () => {
		expect(SHUTDOWN_GRACE_PERIOD_MS).toBeLessThan(FLY_KILL_TIMEOUT_MS)
	})

	test(
		'flushes telemetry and exits cleanly with an open SSE connection',
		async () => {
			const fixture = fileURLToPath(
				new URL('./shutdown.fixture.ts', import.meta.url),
			)
			child = spawn('bun', [fixture], { stdio: ['pipe', 'pipe', 'pipe'] })

			let output = ''
			child.stdout.on('data', (chunk: Buffer) => {
				output += chunk.toString()
			})
			child.stderr.on('data', (chunk: Buffer) => {
				output += chunk.toString()
			})

			const listening = await waitForOutput(child, /LISTENING:(\d+)/)
			const port = Number(listening[1])
			const connected = waitForOutput(child, /SSE_CONNECTED/)
			const request = get(`http://127.0.0.1:${port}/events`)
			await connected

			const exit = waitForExit(child)
			child.kill('SIGINT')
			const result = await Promise.race([
				exit,
				new Promise<'timeout'>((resolve) =>
					setTimeout(() => resolve('timeout'), TEST_DEADLINE_MS),
				),
			])

			request.destroy()
			if (result === 'timeout') {
				throw new Error(`Shutdown exceeded ${TEST_DEADLINE_MS}ms:\n${output}`)
			}
			expect(result).toEqual({ code: 0, signal: null })
			expect(output).toContain('TELEMETRY_FLUSHED')
		},
		TEST_DEADLINE_MS + 1_000,
	)
})
