import { constants, type Dirent, existsSync, promises as nodeFs } from 'node:fs'
import path from 'node:path'
import {
	getS3CredentialsFromEnv,
	signS3Request,
} from '#app/utils/s3-request.server.ts'

/**
 * Resized photos live on the production volume next to SQLite, so the
 * cache gets a budget that stays small next to even a 1 GB volume. A
 * photo's full set is at most 21 resizes no larger than 1200×630 plus one
 * full-size copy, which uploads cap at 3 MB, so this holds every resize of
 * at least 30 photos and usually far more. A resize that's pruned is made
 * again on its next view.
 */
export const IMAGE_CACHE_MAX_BYTES = 100 * 1024 * 1024

/**
 * openimg creates a resize's folder, writes the file, then opens it again by
 * path to answer the request. Files this fresh may still be in that window.
 */
const MIN_AGE_MS = 10 * 60 * 1000

let cacheDir: string | null = null

export async function getImageCacheDir() {
	if (cacheDir) return cacheDir

	let dir = './tests/fixtures/openimg'
	if (process.env.NODE_ENV === 'production') {
		const isAccessible = await nodeFs
			.access('/data', constants.W_OK)
			.then(() => true)
			.catch(() => false)

		if (isAccessible) {
			dir = '/data/images'
		}
	}

	return (cacheDir = dir)
}

type StoredImageSource =
	| { type: 'fs'; path: string }
	| { type: 'fetch'; url: string; headers: Record<string, string> }

function getMockStoragePaths(objectKey: string) {
	return [
		`./tests/fixtures/images/${objectKey}`,
		`./tests/fixtures/uploaded/${objectKey}`,
	]
}

/**
 * Where the image route reads a stored photo from. In MOCKS mode the
 * storage "bucket" is a local folder, so it reads that directly: routing
 * through the mocked fetch hands openimg a stream sharp can't consume under
 * bun. Call only with a key isRecipeImageKey accepts.
 */
export function getStoredImageSource(objectKey: string): StoredImageSource {
	if (process.env.MOCKS === 'true') {
		const [fixturePath, uploadedPath] = getMockStoragePaths(objectKey)
		return {
			type: 'fs',
			path: existsSync(fixturePath!) ? fixturePath! : uploadedPath!,
		}
	}
	const { url, headers } = signS3Request({
		credentials: getS3CredentialsFromEnv(),
		method: 'GET',
		key: objectKey,
	})
	return { type: 'fetch', url, headers }
}

/**
 * The folder and file-name prefix of a source's resizes, built the way
 * openimg's getCachePath names them (it isn't exported):
 * `<cacheFolder>/<host><path, dots and colons as dashes>-w-…`.
 */
function getCachedResizesPrefix(
	cacheFolder: string,
	source: { type: 'fs'; path: string } | { type: 'fetch'; url: string },
) {
	const url = source.type === 'fetch' ? new URL(source.url) : null
	let slug = url
		? url.hostname + url.pathname
		: (source as { path: string }).path
	slug = slug.startsWith('/') ? slug : '/' + slug
	slug = slug
		.replaceAll('.', '-')
		.replaceAll(':', '-')
		.replaceAll('//', '/')
		.replaceAll('/-/', '/')
	const full = cacheFolder + slug
	return { folder: path.dirname(full), prefix: path.basename(full) + '-w-' }
}

/**
 * Delete a stored photo's cached resizes, so a deleted photo stops being
 * served from the cache. Returns how many files went.
 */
export async function removeCachedResizes(
	objectKey: string,
	{ dir }: { dir?: string } = {},
) {
	const cacheFolder = dir ?? (await getImageCacheDir())
	// In MOCKS mode the source is whichever local copy existed when the
	// resize was made, so look under both.
	const sources =
		process.env.MOCKS === 'true'
			? getMockStoragePaths(objectKey).map((p) => ({
					type: 'fs' as const,
					path: p,
				}))
			: [getStoredImageSource(objectKey)]
	let removed = 0
	for (const source of sources) {
		const { folder, prefix } = getCachedResizesPrefix(cacheFolder, source)
		const names = await nodeFs.readdir(folder).catch(() => [])
		for (const name of names) {
			if (!name.startsWith(prefix)) continue
			await nodeFs.rm(path.join(folder, name), { force: true })
			removed++
		}
	}
	return removed
}

export type ImageCachePruneSummary = {
	removedFiles: number
	removedBytes: number
	keptBytes: number
	/** Folders and files the prune wasn't allowed to read or delete. */
	skipped: number
}

type PruneFs = {
	readdir: (
		path: string,
		options: { withFileTypes: true },
	) => Promise<Array<Dirent>>
	stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
	unlink: (path: string) => Promise<void>
}

function errorCode(error: unknown) {
	return (error as NodeJS.ErrnoException | null)?.code
}

function isMissing(error: unknown) {
	return errorCode(error) === 'ENOENT'
}

function isDenied(error: unknown) {
	const code = errorCode(error)
	return code === 'EACCES' || code === 'EPERM'
}

async function listFiles(
	fs: PruneFs,
	dir: string,
	counts: { skipped: number },
): Promise<Array<string>> {
	let entries
	try {
		entries = await fs.readdir(dir, { withFileTypes: true })
	} catch (error) {
		if (isMissing(error)) return []
		if (isDenied(error)) {
			counts.skipped++
			return []
		}
		throw error
	}
	const files: Array<string> = []
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await listFiles(fs, entryPath, counts)))
		} else if (entry.isFile()) files.push(entryPath)
	}
	return files
}

/**
 * When the cache is over `maxBytes`, delete its oldest resizes until it's
 * back under. Folders stay (openimg may be about to write into one), and so
 * does openimg's metadata.json; openimg checks a file exists before serving
 * it from the cache, so its stale entries only mean a fresh resize. A
 * folder or file it isn't allowed to read or delete is skipped and counted.
 */
export async function pruneImageCache({
	dir,
	maxBytes = IMAGE_CACHE_MAX_BYTES,
	minAgeMs = MIN_AGE_MS,
	now = Date.now(),
	fs = nodeFs,
}: {
	dir: string
	maxBytes?: number
	minAgeMs?: number
	now?: number
	fs?: PruneFs
}): Promise<ImageCachePruneSummary> {
	const metadataPath = path.join(dir, 'metadata.json')
	const counts = { skipped: 0 }
	const files: Array<{ path: string; size: number; mtimeMs: number }> = []
	for (const file of await listFiles(fs, dir, counts)) {
		try {
			const { size, mtimeMs } = await fs.stat(file)
			files.push({ path: file, size, mtimeMs })
		} catch (error) {
			// Already gone: a photo delete or another prune got there first.
			if (isMissing(error)) continue
			if (isDenied(error)) counts.skipped++
			else throw error
		}
	}

	let keptBytes = files.reduce((total, file) => total + file.size, 0)
	let removedFiles = 0
	let removedBytes = 0
	const oldestFirst = files
		.filter((file) => file.path !== metadataPath)
		.filter((file) => now - file.mtimeMs >= minAgeMs)
		.sort((a, b) => a.mtimeMs - b.mtimeMs)
	for (const file of oldestFirst) {
		if (keptBytes <= maxBytes) break
		try {
			await fs.unlink(file.path)
			removedFiles++
			removedBytes += file.size
		} catch (error) {
			if (isDenied(error)) {
				// Still on disk, so it still counts against the limit.
				counts.skipped++
				continue
			}
			if (!isMissing(error)) throw error
		}
		keptBytes -= file.size
	}
	return { removedFiles, removedBytes, keptBytes, skipped: counts.skipped }
}
