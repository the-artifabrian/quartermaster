import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createGunzip, createGzip } from 'node:zlib'
import {
	getS3CredentialsFromEnv,
	type S3Credentials,
	signS3Request,
} from '#app/utils/s3-request.server.ts'

/**
 * Offsite backups for the production SQLite database. Driven by
 * `scripts/backup-db.ts` (scheduled from `.github/workflows/backup.yml`) and by
 * the pre-migration step in `other/litefs.yml`; restoring is documented in
 * `docs/RESTORE.md`.
 *
 * LiteFS has no S3 backup of its own — the `backup:` stanza people remember is
 * LiteFS Cloud, which no longer exists — so this takes the route Fly's own
 * LiteFS docs recommend: a periodic consistent snapshot pushed to object
 * storage. The bucket is the one already used for recipe images.
 */

const execFileAsync = promisify(execFile)

export type BackupObject = {
	key: string
	lastModified: Date
	size: number
}

async function sqlite3(args: Array<string>) {
	const { stdout } = await execFileAsync('sqlite3', args, {
		maxBuffer: 4 * 1024 * 1024,
	})
	return stdout.trim()
}

/** SQLite string literals escape a quote by doubling it. */
function quoteSqlString(value: string) {
	return `'${value.replace(/'/g, "''")}'`
}

/** Sorts lexicographically in the same order as chronologically. */
export function backupTimestamp(now: Date) {
	return now.toISOString().replace(/[:.]/g, '-')
}

export function buildBackupKey({
	prefix,
	label,
	now,
}: {
	prefix: string
	label: string
	now: Date
}) {
	return `${prefix}/${label}/${backupTimestamp(now)}.db.gz`
}

/**
 * `VACUUM INTO` reads the source under an ordinary read transaction — no write
 * lock, no checkpoint, nothing LiteFS has to replicate — and writes a compact,
 * internally consistent copy. `.backup` would do as well; this one also drops
 * free pages.
 *
 * The `quick_check` afterwards is the difference between having a backup and
 * believing you have one: it fails here, loudly, rather than during a restore.
 */
export async function snapshotDatabase({
	sourcePath,
	destPath,
}: {
	sourcePath: string
	destPath: string
}) {
	// sqlite3 happily creates an empty database when handed a missing path,
	// which would produce a valid, useless backup.
	await stat(sourcePath)

	await mkdir(path.dirname(destPath), { recursive: true })
	// VACUUM INTO refuses to write to an existing file.
	await rm(destPath, { force: true })
	await sqlite3([sourcePath, `VACUUM INTO ${quoteSqlString(destPath)}`])

	const check = await sqlite3([destPath, 'PRAGMA quick_check'])
	if (check !== 'ok') {
		throw new Error(`Snapshot failed integrity check: ${check}`)
	}
	return destPath
}

export async function gzipFile(sourcePath: string, destPath: string) {
	await pipeline(
		createReadStream(sourcePath),
		createGzip({ level: 9 }),
		createWriteStream(destPath),
	)
	return destPath
}

export async function gunzipFile(sourcePath: string, destPath: string) {
	await pipeline(
		createReadStream(sourcePath),
		createGunzip(),
		createWriteStream(destPath),
	)
	return destPath
}

async function s3Fetch({
	credentials,
	method,
	key,
	query,
	headers,
	body,
}: {
	credentials: S3Credentials
	method: 'GET' | 'PUT' | 'DELETE' | 'HEAD'
	key: string
	query?: Record<string, string>
	headers?: Record<string, string | undefined>
	body?: BodyInit
}) {
	const signed = signS3Request({ credentials, method, key, query, headers })
	const response = await fetch(signed.url, {
		method,
		headers: signed.headers,
		body,
	})
	if (!response.ok) {
		const detail = method === 'HEAD' ? '' : `: ${await response.text()}`
		throw new Error(
			`${method} ${key} failed with ${response.status} ${response.statusText}${detail}`,
		)
	}
	return response
}

/**
 * Uploads and then re-reads the object's size. An upload that "succeeded" but
 * stored a truncated body is the failure mode that only shows up when you need
 * the backup, so it gets checked while someone is still watching.
 */
export async function uploadBackup({
	filePath,
	key,
	credentials = getS3CredentialsFromEnv(),
}: {
	filePath: string
	key: string
	credentials?: S3Credentials
}) {
	const { size } = await stat(filePath)
	// `Bun.file` is a Blob: fetch streams it off disk with a known
	// Content-Length, so the daily backup doesn't allocate the whole archive on
	// a box whose watchdog restarts the machine under memory pressure. Reading
	// it in is the fallback for a non-bun runtime; S3 rejects a body it can't
	// measure, so streaming without a length isn't an option.
	const bunFile = (globalThis as { Bun?: { file: (path: string) => Blob } }).Bun
		?.file
	const body = bunFile ? bunFile(filePath) : await readFile(filePath)

	await s3Fetch({
		credentials,
		method: 'PUT',
		key,
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Length': String(size),
		},
		body,
	})

	const head = await s3Fetch({ credentials, method: 'HEAD', key })
	const storedSize = Number(head.headers.get('Content-Length'))
	if (storedSize !== size) {
		throw new Error(
			`Uploaded ${key} is ${storedSize} bytes offsite but ${size} bytes locally`,
		)
	}
	return { key, size }
}

export async function downloadBackup({
	key,
	destPath,
	credentials = getS3CredentialsFromEnv(),
}: {
	key: string
	destPath: string
	credentials?: S3Credentials
}) {
	const response = await s3Fetch({ credentials, method: 'GET', key })
	await mkdir(path.dirname(destPath), { recursive: true })
	await writeFile(destPath, Buffer.from(await response.arrayBuffer()))
	return destPath
}

/**
 * Hand-parsed because the alternative is an XML parser in the dependency tree
 * for one response shape. ListObjectsV2 keys are XML-escaped, and ours are
 * plain ASCII paths, so only the five predefined entities can appear.
 */
export function parseListObjectsXml(xml: string) {
	const objects: Array<BackupObject> = []
	for (const [, contents] of xml.matchAll(
		/<Contents>([\s\S]*?)<\/Contents>/g,
	)) {
		const key = contents?.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]
		const lastModified = contents?.match(
			/<LastModified>([\s\S]*?)<\/LastModified>/,
		)?.[1]
		if (!key || !lastModified) continue
		objects.push({
			key: unescapeXml(key),
			lastModified: new Date(lastModified),
			size: Number(contents?.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
		})
	}
	const truncated =
		xml.match(/<IsTruncated>(\w+)<\/IsTruncated>/)?.[1] === 'true'
	const continuationToken = xml.match(
		/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/,
	)?.[1]
	return {
		objects,
		continuationToken: truncated
			? unescapeXml(continuationToken ?? '')
			: undefined,
	}
}

function unescapeXml(value: string) {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
}

export async function listBackups({
	prefix,
	credentials = getS3CredentialsFromEnv(),
}: {
	prefix: string
	credentials?: S3Credentials
}) {
	const objects: Array<BackupObject> = []
	let continuationToken: string | undefined
	do {
		const response = await s3Fetch({
			credentials,
			method: 'GET',
			key: '',
			query: {
				'list-type': '2',
				prefix,
				...(continuationToken
					? { 'continuation-token': continuationToken }
					: {}),
			},
		})
		const page = parseListObjectsXml(await response.text())
		objects.push(...page.objects)
		continuationToken = page.continuationToken
	} while (continuationToken)
	return objects.sort(
		(a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
	)
}

/**
 * Age-based expiry with a floor on how many backups survive it: if backups
 * stop being taken, the ones we still have must not quietly age out and leave
 * the bucket empty. The floor is what makes a broken schedule a stale backup
 * rather than no backup.
 */
export function selectExpiredBackups(
	objects: Array<BackupObject>,
	{
		now,
		retentionDays,
		keepMinimum,
	}: { now: Date; retentionDays: number; keepMinimum: number },
) {
	const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
	return [...objects]
		.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
		.slice(keepMinimum)
		.filter((object) => object.lastModified.getTime() < cutoff)
}

export async function pruneRemoteBackups({
	prefix,
	now,
	retentionDays,
	keepMinimum,
	credentials = getS3CredentialsFromEnv(),
}: {
	prefix: string
	now: Date
	retentionDays: number
	keepMinimum: number
	credentials?: S3Credentials
}) {
	const objects = await listBackups({ prefix, credentials })
	const expired = selectExpiredBackups(objects, {
		now,
		retentionDays,
		keepMinimum,
	})
	for (const object of expired) {
		await s3Fetch({ credentials, method: 'DELETE', key: object.key })
	}
	return expired.map((object) => object.key)
}

/** Keeps the newest `keep` files in `dir`; names sort chronologically. */
export async function pruneLocalBackups(dir: string, keep: number) {
	const archives = (await readdir(dir).catch(() => []))
		.filter((name) => name.endsWith('.db.gz'))
		.sort()
	const stale = archives.slice(0, Math.max(0, archives.length - keep))
	for (const name of stale) {
		await rm(path.join(dir, name), { force: true })
	}
	return stale
}

export type RunBackupOptions = {
	sourcePath: string
	/** Directory on the data volume where snapshots are staged. */
	localDir: string
	/** Groups backups by trigger: `daily`, `pre-migration`, … */
	label: string
	/** Key prefix in the bucket; also the prune scope. */
	remotePrefix: string
	upload: boolean
	keepLocal: number
	retentionDays: number
	keepRemoteMinimum: number
	now?: Date
	credentials?: S3Credentials
}

export async function runBackup({
	sourcePath,
	localDir,
	label,
	remotePrefix,
	upload,
	keepLocal,
	retentionDays,
	keepRemoteMinimum,
	now = new Date(),
	credentials,
}: RunBackupOptions) {
	const dir = path.join(localDir, label)
	const stamp = backupTimestamp(now)
	const snapshotPath = path.join(dir, `${stamp}.db`)
	const archivePath = `${snapshotPath}.gz`

	// Prune first, and to one slot below the limit, so this run has somewhere to
	// write. The boot-time dump aborts the boot if it can't snapshot; if pruning
	// came afterwards, a volume that filled up would stay full and the machine
	// would crash-loop until a human intervened. Peak usage is still the
	// uncompressed snapshot plus its archive, which is why the raw file goes
	// away as soon as it's compressed.
	const prunedLocal = await pruneLocalBackups(
		dir,
		Math.max(0, Math.max(1, keepLocal) - 1),
	)

	await snapshotDatabase({ sourcePath, destPath: snapshotPath })
	await gzipFile(snapshotPath, archivePath)
	await rm(snapshotPath, { force: true })
	const { size } = await stat(archivePath)

	if (!upload) {
		return { archivePath, size, key: null, prunedLocal, prunedRemote: [] }
	}

	const resolved = credentials ?? getS3CredentialsFromEnv()
	const key = buildBackupKey({ prefix: remotePrefix, label, now })
	await uploadBackup({ filePath: archivePath, key, credentials: resolved })
	const prunedRemote = await pruneRemoteBackups({
		prefix: `${remotePrefix}/${label}/`,
		now,
		retentionDays,
		keepMinimum: keepRemoteMinimum,
		credentials: resolved,
	})

	return { archivePath, size, key, prunedLocal, prunedRemote }
}
