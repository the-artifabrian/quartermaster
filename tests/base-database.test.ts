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
import { expect, test } from 'vitest'
import { ensureBaseDatabase } from './setup/base-database.ts'

/** A schema and one migration in a temporary directory, removed on dispose. */
async function setupSources() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'base-database-'))
	const schemaPath = path.join(dir, 'schema.prisma')
	const migrationsDirectory = path.join(dir, 'migrations')
	const basePath = path.join(dir, 'base.db')
	let builds = 0

	async function writeMigration(name: string, sql: string) {
		await fs.mkdir(path.join(migrationsDirectory, name), { recursive: true })
		await fs.writeFile(
			path.join(migrationsDirectory, name, 'migration.sql'),
			sql,
		)
	}

	/** A build that writes down which migrations it applied. */
	async function build(databasePath: string) {
		builds++
		const names = (await fs.readdir(migrationsDirectory)).sort()
		await fs.writeFile(databasePath, names.join('\n'))
	}

	await fs.writeFile(schemaPath, 'model Recipe { id String @id }\n')
	await writeMigration('20260101000000_init', 'CREATE TABLE "Recipe" ();\n')
	await fs.writeFile(
		path.join(migrationsDirectory, 'migration_lock.toml'),
		'provider = "sqlite"\n',
	)

	return {
		schemaPath,
		basePath,
		writeMigration,
		build,
		get builds() {
			return builds
		},
		ensure(run = 'a', buildWith = build) {
			return ensureBaseDatabase({
				basePath,
				pendingPath: path.join(dir, `${run}.pending.db`),
				schemaPath,
				migrationsDirectory,
				build: buildWith,
			})
		},
		async [Symbol.asyncDispose]() {
			await fs.rm(dir, { recursive: true, force: true })
		},
	}
}

test('builds the base database when there is none', async () => {
	await using sources = await setupSources()
	expect(await sources.ensure()).toBe('built')
	expect(await fs.readFile(sources.basePath, 'utf8')).toContain(
		'20260101000000_init',
	)
})

test('reuses the base database when nothing changed', async () => {
	await using sources = await setupSources()
	await sources.ensure()
	expect(await sources.ensure()).toBe('reused')
	expect(sources.builds).toBe(1)
})

test('reuses the base database when schema.prisma is saved unchanged', async () => {
	await using sources = await setupSources()
	await sources.ensure()
	const later = new Date(Date.now() + 60_000)
	await fs.utimes(sources.schemaPath, later, later)
	expect(await sources.ensure()).toBe('reused')
})

test('rebuilds after a migration that only adds SQL', async () => {
	await using sources = await setupSources()
	await sources.ensure()
	await sources.writeMigration(
		'20260102000000_recipe_title_check',
		'CREATE TRIGGER "Recipe_title_check" BEFORE INSERT ON "Recipe" BEGIN SELECT 1; END;\n',
	)
	expect(await sources.ensure()).toBe('built')
	expect(await fs.readFile(sources.basePath, 'utf8')).toContain(
		'20260102000000_recipe_title_check',
	)
})

test('rebuilds after an existing migration is edited', async () => {
	await using sources = await setupSources()
	await sources.ensure()
	await sources.writeMigration(
		'20260101000000_init',
		'CREATE TABLE "Recipe" ("id" TEXT NOT NULL PRIMARY KEY);\n',
	)
	expect(await sources.ensure()).toBe('built')
})

test('rebuilds a base database that has no key next to it', async () => {
	await using sources = await setupSources()
	await fs.writeFile(sources.basePath, 'cached before the key existed')
	expect(await sources.ensure()).toBe('built')
	expect(await fs.readFile(sources.basePath, 'utf8')).toContain(
		'20260101000000_init',
	)
})

test('rebuilds when only the key is left', async () => {
	await using sources = await setupSources()
	await sources.ensure()
	await fs.rm(sources.basePath)
	expect(await sources.ensure()).toBe('built')
	expect(await fs.readFile(sources.basePath, 'utf8')).toContain(
		'20260101000000_init',
	)
})

test('two runs at once never expose a half-built database', async () => {
	await using sources = await setupSources()
	await fs.writeFile(sources.basePath, 'stale')
	const seen = new Set<string>()
	let building = true
	const watch = (async () => {
		while (building) {
			seen.add(
				await fs.readFile(sources.basePath, 'utf8').catch(() => 'missing'),
			)
			await new Promise((resolve) => setTimeout(resolve, 1))
		}
	})()
	async function slowBuild(databasePath: string) {
		await fs.writeFile(databasePath, 'half')
		await new Promise((resolve) => setTimeout(resolve, 30))
		await sources.build(databasePath)
	}

	await Promise.all([
		sources.ensure('a', slowBuild),
		sources.ensure('b', slowBuild),
	])
	building = false
	await watch

	expect([...seen].filter((content) => content !== 'stale')).not.toContain(
		'half',
	)
	expect(seen).not.toContain('missing')
	expect(await fs.readFile(sources.basePath, 'utf8')).toContain(
		'20260101000000_init',
	)
	expect(await sources.ensure('c')).toBe('reused')
})
