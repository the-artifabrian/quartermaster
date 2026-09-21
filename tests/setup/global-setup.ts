import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import '#app/utils/env.server.ts'
import { type TestProject } from 'vitest/node'
import { BASE_DATABASE_PATH, RUNS_DIRECTORY } from './database-paths.ts'

/**
 * A run that is killed before its teardown leaves its directory behind. Sweep
 * those on the next run, with a cutoff far longer than any run, so a sweep can
 * never reach a directory another run is still using.
 */
const ABANDONED_RUN_AGE_MS = 24 * 60 * 60 * 1000

declare module 'vitest' {
	interface ProvidedContext {
		databaseRunDirectory: string
	}
}

let runDirectory: string | undefined

async function pathExists(target: string) {
	try {
		await fs.access(target)
		return true
	} catch {
		return false
	}
}

function run(
	cmd: string,
	args: Array<string>,
	opts: { env?: NodeJS.ProcessEnv },
) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: 'inherit', env: opts.env })
		child.once('error', reject)
		child.once('exit', (code) => {
			if (code === 0) resolve()
			else reject(new Error(`${cmd} exited with code ${code}`))
		})
	})
}

async function moveDatabase(from: string, to: string) {
	// SQLite sidecars belong to the database they were created next to, so they
	// travel with it. A clean close usually removes them; rename what is left.
	for (const suffix of ['-wal', '-shm']) {
		await fs.rm(`${to}${suffix}`, { force: true })
		if (await pathExists(`${from}${suffix}`)) {
			await fs.rename(`${from}${suffix}`, `${to}${suffix}`)
		}
	}
	await fs.rename(from, to)
}

async function ensureBaseDatabase(pendingPath: string) {
	if (await pathExists(BASE_DATABASE_PATH)) {
		const databaseLastModifiedAt = (await fs.stat(BASE_DATABASE_PATH)).mtime
		const prismaSchemaLastModifiedAt = (await fs.stat('./prisma/schema.prisma'))
			.mtime

		if (prismaSchemaLastModifiedAt < databaseLastModifiedAt) {
			return
		}
	}

	// Build into this run's own file and rename it into place, so a run that is
	// already copying `base.db` never reads a half-migrated database.
	await run('bunx', ['prisma', 'migrate', 'reset', '--force'], {
		env: { ...process.env, DATABASE_URL: `file:${pendingPath}` },
	})
	await moveDatabase(pendingPath, BASE_DATABASE_PATH)
}

async function removeAbandonedRunDirectories() {
	const cutoff = Date.now() - ABANDONED_RUN_AGE_MS
	const entries = await fs
		.readdir(RUNS_DIRECTORY, { withFileTypes: true })
		.catch(() => [])
	await Promise.all(
		entries.map(async (entry) => {
			const target = path.join(RUNS_DIRECTORY, entry.name)
			const stats = await fs.stat(target).catch(() => null)
			if (!stats || stats.mtimeMs >= cutoff) return
			await fs.rm(target, { recursive: true, force: true })
		}),
	)
}

export async function setup(project: TestProject) {
	const runId = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`
	runDirectory = path.join(RUNS_DIRECTORY, runId)
	await fs.mkdir(runDirectory, { recursive: true })
	project.provide('databaseRunDirectory', runDirectory)

	await removeAbandonedRunDirectories()
	await ensureBaseDatabase(path.join(runDirectory, 'base.pending.db'))
}

export async function teardown() {
	if (!runDirectory) return
	await fs.rm(runDirectory, { recursive: true, force: true })
}
