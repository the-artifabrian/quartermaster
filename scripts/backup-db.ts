/**
 * Takes a consistent snapshot of the production database and pushes it to the
 * object storage bucket. Two callers:
 *
 *   - `.github/workflows/backup.yml` — daily, over `fly ssh console`.
 *   - `other/litefs.yml` — `--local-only --label pre-migration`, before
 *     `prisma migrate deploy` touches the schema at boot.
 *
 * Restoring is documented in `docs/RESTORE.md`.
 */
import { existsSync } from 'node:fs'
import { listBackups, runBackup } from '../server/backup.ts'

const args = process.argv.slice(2)

function flag(name: string) {
	return args.includes(`--${name}`)
}

function option(name: string, fallback: string) {
	const index = args.indexOf(`--${name}`)
	return index >= 0 ? (args[index + 1] ?? fallback) : fallback
}

function numberFromEnv(name: string, fallback: number) {
	const value = Number(process.env[name])
	return Number.isFinite(value) && value >= 0 ? value : fallback
}

const label = option('label', 'daily')
const sourcePath = option(
	'source',
	process.env.DATABASE_PATH ?? 'prisma/data.db',
)
const localDir = option('dir', process.env.BACKUP_DIR ?? '/data/backups')
const remotePrefix =
	process.env.BACKUP_PREFIX ??
	`backups/${process.env.FLY_APP_NAME ?? 'quartermaster'}`

// Escape hatch for the boot-time dump: a full data volume would otherwise turn
// a failed snapshot into a crash-loop. Documented in docs/RESTORE.md; it means
// migrating without a net, so it should be set, deployed, and removed.
//
// Scoped to the boot path on purpose. The same operator is told by the runbook
// to take a manual backup and to `--list` while recovering, and a secret they
// set an hour ago must not turn those into no-ops that exit 0.
if (process.env.SKIP_DB_BACKUP === 'true' && flag('local-only')) {
	console.warn('⚠️ SKIP_DB_BACKUP=true — skipping the pre-migration dump')
	process.exit(0)
}

if (flag('list')) {
	const objects = await listBackups({ prefix: `${remotePrefix}/` })
	for (const object of objects) {
		console.log(
			`${object.lastModified.toISOString()}  ${String(object.size).padStart(12)}  ${object.key}`,
		)
	}
	console.log(`${objects.length} backup(s) under ${remotePrefix}/`)
	process.exit(0)
}

// LiteFS replicas hold a lagging copy and can't be assumed complete; the
// primary is the only node whose snapshot means anything.
const primaryMarker = process.env.LITEFS_DIR
	? `${process.env.LITEFS_DIR}/.primary`
	: null
if (primaryMarker && existsSync(primaryMarker) && !flag('force')) {
	console.warn('⚠️ Not the LiteFS primary — skipping backup')
	process.exit(0)
}

if (!existsSync(sourcePath)) {
	// First boot: the database is created by the migration that follows.
	if (flag('skip-if-missing')) {
		console.warn(`⚠️ No database at ${sourcePath} yet — nothing to back up`)
		process.exit(0)
	}
	console.error(`❌ No database at ${sourcePath}`)
	process.exit(1)
}

const startedAt = Date.now()
const result = await runBackup({
	sourcePath,
	localDir,
	label,
	remotePrefix,
	upload: !flag('local-only'),
	keepLocal: numberFromEnv('BACKUP_KEEP_LOCAL', 3),
	retentionDays: numberFromEnv('BACKUP_RETENTION_DAYS', 30),
	keepRemoteMinimum: numberFromEnv('BACKUP_KEEP_MINIMUM', 7),
})

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
if (result.prunedLocal.length) {
	console.log(`🧹 Pruned ${result.prunedLocal.length} local snapshot(s)`)
}
if (result.prunedRemote.length) {
	console.log(`🧹 Pruned ${result.prunedRemote.length} expired backup(s)`)
}
// The workflow greps for this line: `fly ssh console -C` does not reliably
// propagate the remote exit status.
console.log(
	`BACKUP OK ${result.key ?? result.archivePath} ${result.size} bytes in ${seconds}s`,
)
