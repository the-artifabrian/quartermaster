import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

async function pathExists(target: string) {
	try {
		await fs.access(target)
		return true
	} catch {
		return false
	}
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

async function listFiles(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, {
		recursive: true,
		withFileTypes: true,
	})
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path
				.relative(directory, path.join(entry.parentPath, entry.name))
				.split(path.sep)
				.join('/'),
		)
		.sort()
}

/**
 * A hash of everything that shapes the migrated database: the schema and every
 * file under the migrations directory, by name and content. Modification times
 * stay out of it, so a migration that only adds SQL changes the key and a save
 * without changes does not.
 */
export async function hashDatabaseSources({
	schemaPath,
	migrationsDirectory,
}: {
	schemaPath: string
	migrationsDirectory: string
}) {
	const hash = crypto.createHash('sha256')
	hash.update('schema.prisma\0')
	hash.update(await fs.readFile(schemaPath))
	for (const file of await listFiles(migrationsDirectory)) {
		hash.update(`\0migrations/${file}\0`)
		hash.update(await fs.readFile(path.join(migrationsDirectory, file)))
	}
	return hash.digest('hex')
}

/**
 * Makes sure `basePath` holds a database migrated from the current schema and
 * migrations. The hash of those sits next to it in `<basePath>.hash`; when it
 * matches, the database is reused.
 */
export async function ensureBaseDatabase({
	basePath,
	pendingPath,
	schemaPath,
	migrationsDirectory,
	build,
}: {
	basePath: string
	pendingPath: string
	schemaPath: string
	migrationsDirectory: string
	build: (databasePath: string) => Promise<void>
}) {
	const keyPath = `${basePath}.hash`
	const sourcesHash = await hashDatabaseSources({
		schemaPath,
		migrationsDirectory,
	})
	const cachedHash = await fs.readFile(keyPath, 'utf8').catch(() => null)
	if (cachedHash === sourcesHash && (await pathExists(basePath))) {
		return 'reused' as const
	}

	// Build into this run's own file and rename it into place, so a run that is
	// already copying `base.db` never reads a half-migrated database. The old
	// key goes before the new database comes in and the new key after it, so a
	// run stopped in between leaves no key and the next run builds again.
	await build(pendingPath)
	await fs.rm(keyPath, { force: true })
	await moveDatabase(pendingPath, basePath)
	await fs.writeFile(`${pendingPath}.hash`, sourcesHash)
	await fs.rename(`${pendingPath}.hash`, keyPath)
	return 'built' as const
}
