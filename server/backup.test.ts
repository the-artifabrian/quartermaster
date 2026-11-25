import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import express from 'express'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { type S3Credentials } from '#app/utils/s3-request.server.ts'
import {
	backupBeforeMigrations,
	buildBackupKey,
	downloadBackup,
	gunzipFile,
	listBackups,
	parseListObjectsXml,
	pruneLocalBackups,
	runBackup,
	selectExpiredBackups,
	snapshotDatabase,
} from './backup.ts'

const execFileAsync = promisify(execFile)

// The snapshot path shells out to sqlite3 the same way other/litefs.yml does.
// It ships in the container image and on CI runners; asserted per test so a
// dev box missing it reports that, rather than a confusing spawn error.
let hasSqlite3 = false
beforeAll(async () => {
	hasSqlite3 = await execFileAsync('sqlite3', ['--version']).then(
		() => true,
		() => false,
	)
})

const tempDirs: Array<string> = []
type Server = ReturnType<express.Express['listen']>
const servers: Array<Server> = []

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.closeAllConnections()
					server.close(() => resolve())
				}),
		),
	)
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	)
})

async function makeTempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'qm-backup-'))
	tempDirs.push(dir)
	return dir
}

async function makeDatabase(filePath: string, rows = 50) {
	const values = Array.from({ length: rows }, (_, i) => `('user-${i}')`).join(
		',',
	)
	await execFileAsync('sqlite3', [
		filePath,
		`PRAGMA journal_mode = WAL;
		 CREATE TABLE User (username TEXT);
		 INSERT INTO User (username) VALUES ${values};`,
	])
	return filePath
}

/**
 * An S3 stand-in: enough of PUT/GET/HEAD/DELETE/ListObjectsV2 to run the real
 * backup path end to end, including the signed requests, without reaching for
 * the production bucket.
 */
async function startFakeS3(
	seed: Record<string, { body: Buffer; date: Date }> = {},
) {
	const bucket = 'test-bucket'
	const objects = new Map(Object.entries(seed))
	const app = express()
	app.use(express.raw({ type: '*/*', limit: '64mb' }))

	app.get(`/${bucket}`, (req, res) => {
		const prefix = String(req.query.prefix ?? '')
		const contents = [...objects.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(
				([key, object]) =>
					`<Contents><Key>${key}</Key><LastModified>${object.date.toISOString()}</LastModified><Size>${object.body.length}</Size></Contents>`,
			)
			.join('')
		res
			.type('application/xml')
			.send(
				`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
			)
	})

	// Express 5 hands wildcard params over as path segments.
	const keyOf = (req: express.Request) =>
		([] as Array<string>).concat(req.params.key as never).join('/')

	app.put(`/${bucket}/*key`, (req, res) => {
		objects.set(keyOf(req), {
			body: req.body as Buffer,
			date: new Date(),
		})
		res.status(200).end()
	})

	app.get(`/${bucket}/*key`, (req, res) => {
		const object = objects.get(keyOf(req))
		if (!object) return res.status(404).end()
		res.type('application/gzip').send(object.body)
	})

	app.head(`/${bucket}/*key`, (req, res) => {
		const object = objects.get(keyOf(req))
		if (!object) return res.status(404).end()
		res.setHeader('Content-Length', String(object.body.length))
		res.status(200).end()
	})

	app.delete(`/${bucket}/*key`, (req, res) => {
		objects.delete(keyOf(req))
		res.status(204).end()
	})

	const server = await new Promise<Server>((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s))
	})
	servers.push(server)
	const { port } = server.address() as AddressInfo
	const credentials: S3Credentials = {
		endpoint: `http://127.0.0.1:${port}`,
		bucket,
		accessKeyId: 'test-key',
		secretAccessKey: 'test-secret',
		region: 'auto',
	}
	return { credentials, objects }
}

test('a backup round-trips: snapshot, upload, download, still a valid database', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	const { credentials, objects } = await startFakeS3()

	const result = await runBackup({
		sourcePath,
		localDir: path.join(dir, 'backups'),
		label: 'daily',
		remotePrefix: 'backups/test-app',
		upload: true,
		keepLocal: 3,
		retentionDays: 30,
		keepRemoteMinimum: 7,
		credentials,
	})

	expect(result.key).toMatch(/^backups\/test-app\/daily\/.*\.db\.gz$/)
	expect(objects.has(result.key!)).toBe(true)
	// Compressed, so smaller than the page-aligned database it came from.
	expect(result.size).toBeGreaterThan(0)

	const archivePath = path.join(dir, 'restored.db.gz')
	await downloadBackup({
		key: result.key!,
		destPath: archivePath,
		credentials,
	})
	const restoredPath = path.join(dir, 'restored.db')
	await gunzipFile(archivePath, restoredPath)

	const { stdout: check } = await execFileAsync('sqlite3', [
		restoredPath,
		'PRAGMA quick_check',
	])
	expect(check.trim()).toBe('ok')
	const { stdout: count } = await execFileAsync('sqlite3', [
		restoredPath,
		'SELECT COUNT(*) FROM User',
	])
	expect(count.trim()).toBe('50')
})

test('a local-only backup writes to disk and never touches the network', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))

	const result = await runBackup({
		sourcePath,
		localDir: path.join(dir, 'backups'),
		label: 'pre-migration',
		remotePrefix: 'backups/test-app',
		upload: false,
		keepLocal: 3,
		retentionDays: 30,
		keepRemoteMinimum: 7,
		// No credentials: reaching for them would throw.
	})

	expect(result.key).toBeNull()
	const entries = await readdir(path.join(dir, 'backups', 'pre-migration'))
	expect(entries).toEqual([path.basename(result.archivePath)])
})

test('stale snapshots are pruned before the new one is written', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	const stagingDir = path.join(dir, 'backups', 'pre-migration')
	await mkdir(stagingDir, { recursive: true })
	for (const name of ['2026-01-01.db.gz', '2026-01-02.db.gz']) {
		await writeFile(path.join(stagingDir, name), 'old')
	}

	// Pruning has to come first: a volume with no room left is exactly when the
	// boot-time dump runs, and it aborts the boot if it can't write.
	const result = await runBackup({
		sourcePath,
		localDir: path.join(dir, 'backups'),
		label: 'pre-migration',
		remotePrefix: 'backups/test-app',
		upload: false,
		keepLocal: 2,
		retentionDays: 30,
		keepRemoteMinimum: 7,
	})

	expect(result.prunedLocal).toEqual(['2026-01-01.db.gz'])
	expect((await readdir(stagingDir)).sort()).toEqual([
		'2026-01-02.db.gz',
		path.basename(result.archivePath),
	])
})

test('a snapshot of a corrupt database fails loudly instead of being stored', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = path.join(dir, 'corrupt.db')
	// A valid header followed by garbage: sqlite3 opens it, then chokes.
	await writeFile(
		sourcePath,
		Buffer.concat([
			Buffer.from('SQLite format 3\0', 'binary'),
			Buffer.alloc(4096, 0xff),
		]),
	)

	await expect(
		snapshotDatabase({ sourcePath, destPath: path.join(dir, 'out.db') }),
	).rejects.toThrow()
})

test('a missing database is an error, not an empty backup', async () => {
	const dir = await makeTempDir()
	await expect(
		snapshotDatabase({
			sourcePath: path.join(dir, 'nope.db'),
			destPath: path.join(dir, 'out.db'),
		}),
	).rejects.toThrow(/ENOENT/)
})

test('expired backups are pruned, but never below the minimum kept', async () => {
	const now = new Date('2026-07-29T00:00:00.000Z')
	const day = 24 * 60 * 60 * 1000
	const objects = Array.from({ length: 10 }, (_, i) => ({
		key: `backups/app/daily/${i}.db.gz`,
		lastModified: new Date(now.getTime() - i * 10 * day),
		size: 100,
	}))

	const expired = selectExpiredBackups(objects, {
		now,
		retentionDays: 30,
		keepMinimum: 7,
	})
	// Objects 0-6 are the newest seven and survive on the floor alone; 7, 8 and
	// 9 are 70+ days old and go.
	expect(expired.map((object) => object.key)).toEqual([
		'backups/app/daily/7.db.gz',
		'backups/app/daily/8.db.gz',
		'backups/app/daily/9.db.gz',
	])
})

test('nothing is pruned when the schedule has stalled and every backup is old', async () => {
	const now = new Date('2026-07-29T00:00:00.000Z')
	const objects = Array.from({ length: 3 }, (_, i) => ({
		key: `backups/app/daily/${i}.db.gz`,
		lastModified: new Date('2026-01-01T00:00:00.000Z'),
		size: 100,
	}))
	expect(
		selectExpiredBackups(objects, { now, retentionDays: 30, keepMinimum: 7 }),
	).toEqual([])
})

test('local staging keeps only the newest snapshots', async () => {
	const dir = await makeTempDir()
	for (const name of [
		'1.db.gz',
		'2.db.gz',
		'3.db.gz',
		'4.db.gz',
		'notes.txt',
	]) {
		await writeFile(path.join(dir, name), 'x')
	}
	const pruned = await pruneLocalBackups(dir, 2)
	expect(pruned).toEqual(['1.db.gz', '2.db.gz'])
	expect((await readdir(dir)).sort()).toEqual([
		'3.db.gz',
		'4.db.gz',
		'notes.txt',
	])
})

test('listing pages through the bucket and sorts newest first', async () => {
	const older = new Date('2026-07-01T00:00:00.000Z')
	const newer = new Date('2026-07-28T00:00:00.000Z')
	const { credentials } = await startFakeS3({
		'backups/test-app/daily/old.db.gz': { body: Buffer.from('a'), date: older },
		'backups/test-app/daily/new.db.gz': { body: Buffer.from('b'), date: newer },
		'users/someone/image.jpg': { body: Buffer.from('c'), date: newer },
	})

	const objects = await listBackups({
		prefix: 'backups/test-app/',
		credentials,
	})
	expect(objects.map((object) => object.key)).toEqual([
		'backups/test-app/daily/new.db.gz',
		'backups/test-app/daily/old.db.gz',
	])
})

test('parses a ListObjectsV2 page, including continuation', () => {
	const { objects, continuationToken } = parseListObjectsXml(`
		<?xml version="1.0" encoding="UTF-8"?>
		<ListBucketResult>
			<IsTruncated>true</IsTruncated>
			<NextContinuationToken>token/with+chars=</NextContinuationToken>
			<Contents>
				<Key>backups/app/daily/2026-07-28.db.gz</Key>
				<LastModified>2026-07-28T04:17:00.000Z</LastModified>
				<Size>1234</Size>
			</Contents>
		</ListBucketResult>`)

	expect(objects).toEqual([
		{
			key: 'backups/app/daily/2026-07-28.db.gz',
			lastModified: new Date('2026-07-28T04:17:00.000Z'),
			size: 1234,
		},
	])
	expect(continuationToken).toBe('token/with+chars=')
})

test('backup keys sort chronologically within a label', () => {
	const earlier = buildBackupKey({
		prefix: 'backups/app',
		label: 'daily',
		now: new Date('2026-07-28T04:17:00.000Z'),
	})
	const later = buildBackupKey({
		prefix: 'backups/app',
		label: 'daily',
		now: new Date('2026-07-29T04:17:00.000Z'),
	})
	// Sorting by name is how `--latest` and local pruning find the newest.
	expect([later, earlier].sort()).toEqual([earlier, later])
	expect(later).toBe('backups/app/daily/2026-07-29T04-17-00-000Z.db.gz')
})

type MigrationRow = {
	name: string
	finished?: boolean
	rolledBack?: boolean
}

/** The table `prisma migrate deploy` keeps, with the columns it reads. */
async function recordMigrations(
	databasePath: string,
	rows: Array<MigrationRow>,
) {
	const values = rows
		.map(
			({ name, finished = true, rolledBack = false }, i) =>
				`('${i}-${name}', '${name}', ${finished ? 'CURRENT_TIMESTAMP' : 'NULL'}, ${rolledBack ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
		)
		.join(',')
	await execFileAsync('sqlite3', [
		databasePath,
		`CREATE TABLE IF NOT EXISTS _prisma_migrations (
			id TEXT PRIMARY KEY NOT NULL,
			checksum TEXT NOT NULL DEFAULT '',
			finished_at DATETIME,
			migration_name TEXT NOT NULL,
			logs TEXT,
			rolled_back_at DATETIME,
			started_at DATETIME NOT NULL DEFAULT current_timestamp,
			applied_steps_count INTEGER UNSIGNED NOT NULL DEFAULT 0
		);
		${rows.length ? `INSERT INTO _prisma_migrations (id, migration_name, finished_at, rolled_back_at) VALUES ${values};` : ''}`,
	])
}

/** A migrations folder as Prisma lays it out, lock file included. */
async function makeMigrationsDir(dir: string, names: Array<string>) {
	await mkdir(dir, { recursive: true })
	await writeFile(path.join(dir, 'migration_lock.toml'), 'provider = "sqlite"')
	for (const name of names) {
		await mkdir(path.join(dir, name))
		await writeFile(path.join(dir, name, 'migration.sql'), 'SELECT 1;')
	}
	return dir
}

async function bootDump(
	dir: string,
	sourcePath: string,
	migrationsDir: string,
	now: Date,
) {
	return backupBeforeMigrations({
		sourcePath,
		migrationsDir,
		localDir: path.join(dir, 'backups'),
		label: 'pre-migration',
		remotePrefix: 'backups/test-app',
		upload: false,
		keepLocal: 3,
		retentionDays: 30,
		keepRemoteMinimum: 7,
		now,
	})
}

const bootAt = (minute: number) =>
	new Date(`2026-11-25T10:${String(minute).padStart(2, '0')}:00.000Z`)

test('a crash loop after a migration keeps the dump from before it', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	await recordMigrations(sourcePath, [{ name: '1_init' }])
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
		'2_drop_users',
	])

	const first = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(first.pending).toEqual(['2_drop_users'])
	const before = first.result?.archivePath
	expect(before).toBeDefined()

	// The migration runs, and then the app keeps failing to start.
	await execFileAsync('sqlite3', [sourcePath, 'DELETE FROM User'])
	await recordMigrations(sourcePath, [{ name: '2_drop_users' }])
	for (const minute of [1, 2, 3]) {
		await bootDump(dir, sourcePath, migrationsDir, bootAt(minute))
	}

	const stagingDir = path.join(dir, 'backups', 'pre-migration')
	expect(await readdir(stagingDir)).toEqual([path.basename(before!)])
	const restoredPath = path.join(dir, 'restored.db')
	await gunzipFile(before!, restoredPath)
	const { stdout: count } = await execFileAsync('sqlite3', [
		restoredPath,
		'SELECT COUNT(*) FROM User',
	])
	expect(count.trim()).toBe('50')
})

test('a database restored from an older backup gets a dump before it is migrated forward', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	await recordMigrations(sourcePath, [{ name: '1_init' }])
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
		'2_add_menus',
		'3_add_staples',
	])

	const boot = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(boot.pending).toEqual(['2_add_menus', '3_add_staples'])
	expect(boot.result).not.toBeNull()
})

test('a boot with every migration applied takes no dump, even with a lock file and a stray file in the folder', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	await recordMigrations(sourcePath, [{ name: '1_init' }, { name: '2_menus' }])
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
		'2_menus',
	])
	await writeFile(path.join(migrationsDir, 'README.md'), 'x')

	const boot = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(boot.pending).toEqual([])
	expect(boot.result).toBeNull()
	expect(await readdir(path.join(dir, 'backups')).catch(() => [])).toEqual([])
})

test('restarts after a migration failed partway leave the clean dump alone', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	// Prisma leaves the failed row unfinished and refuses to apply anything
	// newer until someone resolves it, so nothing will change on this boot.
	await recordMigrations(sourcePath, [
		{ name: '1_init' },
		{ name: '2_broken', finished: false },
	])
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
		'2_broken',
		'3_newer',
	])

	const boot = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(boot.result).toBeNull()
	expect(boot.reason).toMatch(/2_broken/)
})

test('a migration marked as rolled back is pending again and gets a dump', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	await recordMigrations(sourcePath, [
		{ name: '1_init' },
		{ name: '2_broken', finished: false, rolledBack: true },
	])
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
		'2_broken',
	])

	const boot = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(boot.pending).toEqual(['2_broken'])
	expect(boot.result).not.toBeNull()
})

test('a database Prisma has never migrated gets a dump', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
	])

	const boot = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(boot.result).not.toBeNull()
	expect(boot.unknown).toBeFalsy()
	expect(boot.reason).toMatch(/never been migrated/)
})

test("a migration history that can't be read gets a dump and a warning with sqlite's own message", async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	await execFileAsync('sqlite3', [
		sourcePath,
		'CREATE TABLE _prisma_migrations (id TEXT)',
	])
	const migrationsDir = await makeMigrationsDir(path.join(dir, 'migrations'), [
		'1_init',
	])

	const boot = await bootDump(dir, sourcePath, migrationsDir, bootAt(0))
	expect(boot.result).not.toBeNull()
	expect(boot.unknown).toBe(true)
	expect(boot.reason).toMatch(/no such column/)
})

test('a migrations folder that is missing or empty still gets a dump', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	await recordMigrations(sourcePath, [{ name: '1_init' }])

	const missing = await bootDump(
		dir,
		sourcePath,
		path.join(dir, 'nowhere'),
		bootAt(0),
	)
	expect(missing.result).not.toBeNull()

	const empty = await bootDump(
		dir,
		sourcePath,
		await makeMigrationsDir(path.join(dir, 'empty'), []),
		bootAt(1),
	)
	expect(empty.result).not.toBeNull()
})

test('the boot script finds the real migrations folder from any working directory', async () => {
	expect(hasSqlite3).toBe(true)
	const dir = await makeTempDir()
	const sourcePath = await makeDatabase(path.join(dir, 'sqlite.db'))
	const repoMigrations = path.join(import.meta.dirname, '../prisma/migrations')
	const names = (await readdir(repoMigrations, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
	await recordMigrations(
		sourcePath,
		names.map((name) => ({ name })),
	)

	const { LITEFS_DIR, SKIP_DB_BACKUP, ...env } = process.env
	const { stdout } = await execFileAsync(
		'bun',
		[
			path.join(import.meta.dirname, '../scripts/backup-db.ts'),
			'--source',
			sourcePath,
			'--dir',
			path.join(dir, 'backups'),
			'--local-only',
			'--label',
			'pre-migration',
			'--only-if-migrations-pending',
		],
		{ cwd: dir, env },
	)

	expect(stdout).toMatch(/no pending migrations/)
	expect(await readdir(path.join(dir, 'backups')).catch(() => [])).toEqual([])
})
