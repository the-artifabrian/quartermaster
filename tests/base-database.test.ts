// Failure list for `ensureBaseDatabase` (setup/base-database.ts), the cached
// migrated database every Vitest worker copies:
// - A new migration that only adds SQL (a CHECK, a trigger) leaves
//   schema.prisma alone, and the cache keeps serving a database without it.
// - An existing migration is edited, and the cache keeps the old one.
// - Nothing changed, and every run rebuilds anyway (slow, but also a sign the
//   key is unstable).
// - schema.prisma is saved without changes, and that alone forces a rebuild.
// - There is no cached database yet, or only its key is left behind.
// - A database cached before the key existed has no key next to it, and is
//   trusted as current.
// - Two runs start at once: one copies `base.db` while the other is still
//   migrating, and reads half a database.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ensureBaseDatabase } from './setup/base-database.ts'

let dir: string
let schemaPath: string
let migrationsDirectory: string
let basePath: string
let builds: number

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'base-database-'))
	schemaPath = path.join(dir, 'schema.prisma')
	migrationsDirectory = path.join(dir, 'migrations')
	basePath = path.join(dir, 'base.db')
	builds = 0
	await fs.writeFile(schemaPath, 'model Recipe { id String @id }\n')
	await writeMigration('20260101000000_init', 'CREATE TABLE "Recipe" ();\n')
	await fs.writeFile(
		path.join(migrationsDirectory, 'migration_lock.toml'),
		'provider = "sqlite"\n',
	)
})

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

async function writeMigration(name: string, sql: string) {
	await fs.mkdir(path.join(migrationsDirectory, name), { recursive: true })
	await fs.writeFile(path.join(migrationsDirectory, name, 'migration.sql'), sql)
}

/** A build that writes down which migrations it applied. */
async function build(databasePath: string) {
	builds++
	const names = (await fs.readdir(migrationsDirectory)).sort()
	await fs.writeFile(databasePath, names.join('\n'))
}

function ensure(run = 'a', buildWith = build) {
	return ensureBaseDatabase({
		basePath,
		pendingPath: path.join(dir, `${run}.pending.db`),
		schemaPath,
		migrationsDirectory,
		build: buildWith,
	})
}

test('builds the base database when there is none', async () => {
	expect(await ensure()).toBe('built')
	expect(await fs.readFile(basePath, 'utf8')).toContain('20260101000000_init')
})

test('reuses the base database when nothing changed', async () => {
	await ensure()
	expect(await ensure()).toBe('reused')
	expect(builds).toBe(1)
})

test('reuses the base database when schema.prisma is saved unchanged', async () => {
	await ensure()
	const later = new Date(Date.now() + 60_000)
	await fs.utimes(schemaPath, later, later)
	expect(await ensure()).toBe('reused')
})

test('rebuilds after a migration that only adds SQL', async () => {
	await ensure()
	await writeMigration(
		'20260102000000_recipe_title_check',
		'CREATE TRIGGER "Recipe_title_check" BEFORE INSERT ON "Recipe" BEGIN SELECT 1; END;\n',
	)
	expect(await ensure()).toBe('built')
	expect(await fs.readFile(basePath, 'utf8')).toContain(
		'20260102000000_recipe_title_check',
	)
})

test('rebuilds after an existing migration is edited', async () => {
	await ensure()
	await writeMigration(
		'20260101000000_init',
		'CREATE TABLE "Recipe" ("id" TEXT NOT NULL PRIMARY KEY);\n',
	)
	expect(await ensure()).toBe('built')
})

test('rebuilds a base database that has no key next to it', async () => {
	await fs.writeFile(basePath, 'cached before the key existed')
	expect(await ensure()).toBe('built')
	expect(await fs.readFile(basePath, 'utf8')).toContain('20260101000000_init')
})

test('rebuilds when only the key is left', async () => {
	await ensure()
	await fs.rm(basePath)
	expect(await ensure()).toBe('built')
	expect(await fs.readFile(basePath, 'utf8')).toContain('20260101000000_init')
})

test('two runs at once never expose a half-built database', async () => {
	await fs.writeFile(basePath, 'stale')
	const seen = new Set<string>()
	let building = true
	const watch = (async () => {
		while (building) {
			seen.add(await fs.readFile(basePath, 'utf8').catch(() => 'missing'))
			await new Promise((resolve) => setTimeout(resolve, 1))
		}
	})()
	async function slowBuild(databasePath: string) {
		await fs.writeFile(databasePath, 'half')
		await new Promise((resolve) => setTimeout(resolve, 30))
		await build(databasePath)
	}

	await Promise.all([ensure('a', slowBuild), ensure('b', slowBuild)])
	building = false
	await watch

	expect([...seen].filter((content) => content !== 'stale')).not.toContain(
		'half',
	)
	expect(seen).not.toContain('missing')
	expect(await fs.readFile(basePath, 'utf8')).toContain('20260101000000_init')
	expect(await ensure('c')).toBe('reused')
})
