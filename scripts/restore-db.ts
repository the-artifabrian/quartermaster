/**
 * Fetches a backup from object storage, unpacks it, and checks it opens as a
 * valid SQLite database. It deliberately stops there: putting the file back
 * into LiteFS is a `litefs import` away, and that step belongs in front of a
 * human following `docs/RESTORE.md`.
 *
 *   bun scripts/restore-db.ts --list
 *   bun scripts/restore-db.ts --latest            # newest daily backup
 *   bun scripts/restore-db.ts --key backups/… --out /data/restore/sqlite.db
 */
import { execFile } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { downloadBackup, gunzipFile, listBackups } from '../server/backup.ts'

const execFileAsync = promisify(execFile)
const args = process.argv.slice(2)

function flag(name: string) {
	return args.includes(`--${name}`)
}

function option(name: string, fallback: string) {
	const index = args.indexOf(`--${name}`)
	return index >= 0 ? (args[index + 1] ?? fallback) : fallback
}

const remotePrefix =
	process.env.BACKUP_PREFIX ??
	`backups/${process.env.FLY_APP_NAME ?? 'quartermaster'}`
const label = option('label', 'daily')

if (flag('list')) {
	const objects = await listBackups({ prefix: `${remotePrefix}/` })
	for (const object of objects) {
		console.log(
			`${object.lastModified.toISOString()}  ${String(object.size).padStart(12)}  ${object.key}`,
		)
	}
	process.exit(0)
}

let key = option('key', '')
if (!key) {
	if (!flag('latest')) {
		console.error('❌ Pass --key <object key>, --latest, or --list')
		process.exit(1)
	}
	const [newest] = await listBackups({ prefix: `${remotePrefix}/${label}/` })
	if (!newest) {
		console.error(`❌ No backups under ${remotePrefix}/${label}/`)
		process.exit(1)
	}
	key = newest.key
	console.log(
		`📦 Latest ${label} backup: ${key} (${newest.lastModified.toISOString()})`,
	)
}

const outPath = option('out', '/data/restore/restored.db')
const archivePath = `${outPath}.gz`

await downloadBackup({ key, destPath: archivePath })
await gunzipFile(archivePath, outPath)
await rm(archivePath, { force: true })

const { stdout } = await execFileAsync('sqlite3', [
	outPath,
	'PRAGMA quick_check',
])
if (stdout.trim() !== 'ok') {
	console.error(`❌ Restored file failed integrity check: ${stdout.trim()}`)
	process.exit(1)
}

const { size } = await stat(outPath)
const { stdout: users } = await execFileAsync('sqlite3', [
	outPath,
	'SELECT COUNT(*) FROM User',
]).catch(() => ({ stdout: 'unknown' }))

console.log(
	`✅ Restored ${key} → ${outPath} (${size} bytes, ${users.trim()} users)`,
)
console.log(`Next: follow docs/RESTORE.md to import it into LiteFS.`)
