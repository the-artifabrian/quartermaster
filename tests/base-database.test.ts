// `ensureBaseDatabase` (setup/base-database.ts) keeps the cached migrated
// database every Vitest worker copies. Its key must change with the
// migrations, including one that only adds SQL and leaves schema.prisma alone.
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
		async removeMigration(name: string) {
			await fs.rm(path.join(migrationsDirectory, name), { recursive: true })
		},
		pendingPath(run: string) {
			return path.join(dir, `${run}.pending.db`)
		},
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

// A rebuild here would be slow, and a sign the key is unstable.
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

// The old key beside the new database would match again once the sources go
// back, as when switching branches, and the wrong database would be reused.
test('a run stopped before writing its key leaves nothing to reuse', async () => {
	await using sources = await setupSources()
	await sources.ensure()
	await sources.writeMigration('20260102000000_recipe_notes', 'SELECT 1;\n')
	// A directory where the key would go makes the run fail right after it
	// moves its database in, as a run killed at that moment would.
	await fs.mkdir(`${sources.pendingPath('b')}.hash`)
	await expect(sources.ensure('b')).rejects.toThrow()
	expect(await fs.readFile(sources.basePath, 'utf8')).toContain(
		'20260102000000_recipe_notes',
	)

	await sources.removeMigration('20260102000000_recipe_notes')
	expect(await sources.ensure('c')).toBe('built')
	expect(await fs.readFile(sources.basePath, 'utf8')).not.toContain(
		'20260102000000_recipe_notes',
	)
})
