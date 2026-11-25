// The resized-photo cache sits on the same volume as the database, so pruning
// must keep it from growing without end.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { pruneImageCache, removeCachedResizes } from './image-cache.server.ts'

const NOW = new Date('2026-11-20T12:00:00Z').getTime()
const HOUR = 60 * 60 * 1000
let dir: string

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-cache-'))
})

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

/** A cached file of `bytes` bytes last written `ageMs` before NOW. */
async function cached(relative: string, bytes: number, ageMs: number) {
	const file = path.join(dir, relative)
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, Buffer.alloc(bytes))
	const time = new Date(NOW - ageMs)
	await fs.utimes(file, time, time)
	return file
}

async function remaining() {
	const entries = await fs.readdir(dir, {
		recursive: true,
		withFileTypes: true,
	})
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
		.sort()
}

test('does nothing when the cache folder does not exist', async () => {
	const result = await pruneImageCache({
		dir: path.join(dir, 'missing'),
		maxBytes: 0,
		now: NOW,
	})
	expect(result).toEqual({
		removedFiles: 0,
		removedBytes: 0,
		keptBytes: 0,
		skipped: 0,
	})
})

test('does nothing when the cache folder is empty', async () => {
	const result = await pruneImageCache({ dir, maxBytes: 0, now: NOW })
	expect(result).toEqual({
		removedFiles: 0,
		removedBytes: 0,
		keptBytes: 0,
		skipped: 0,
	})
})

test('keeps everything while the cache is under the limit', async () => {
	await cached('a/1.webp', 100, 3 * HOUR)
	await cached('b/2.webp', 100, 2 * HOUR)
	const result = await pruneImageCache({ dir, maxBytes: 200, now: NOW })
	expect(result.removedFiles).toBe(0)
	expect(await remaining()).toEqual(['a/1.webp', 'b/2.webp'])
})

test('removes the oldest resizes first, only until the cache is under the limit', async () => {
	await cached('host/users/u/recipes/r/images/a-w-72.webp', 100, 5 * HOUR)
	await cached('host/users/u/recipes/r/images/a-w-400.webp', 100, 4 * HOUR)
	await cached('host/users/v/recipes/s/images/b-w-72.webp', 100, 3 * HOUR)
	await cached('host/users/v/recipes/s/images/b-w-400.webp', 100, 2 * HOUR)
	const result = await pruneImageCache({ dir, maxBytes: 250, now: NOW })
	expect(result).toEqual({
		removedFiles: 2,
		removedBytes: 200,
		keptBytes: 200,
		skipped: 0,
	})
	expect(await remaining()).toEqual([
		'host/users/v/recipes/s/images/b-w-400.webp',
		'host/users/v/recipes/s/images/b-w-72.webp',
	])
	// The emptied folder stays: openimg may be about to write into it.
	await expect(
		fs.stat(path.join(dir, 'host/users/u/recipes/r/images')),
	).resolves.toBeTruthy()
})

test('never removes openimg’s metadata file', async () => {
	await cached('metadata.json', 100, 10 * HOUR)
	await cached('a/1.webp', 100, 3 * HOUR)
	await pruneImageCache({ dir, maxBytes: 0, now: NOW })
	expect(await remaining()).toEqual(['metadata.json'])
})

// openimg makes its folder, writes the file, then reopens it by path to
// answer, so a fresh file and every folder must be left alone.
test('never removes a file written in the last few minutes, even over the limit', async () => {
	await cached('a/old.webp', 100, 3 * HOUR)
	await cached('a/writing.webp', 100, 1000)
	const result = await pruneImageCache({ dir, maxBytes: 0, now: NOW })
	expect(result.removedFiles).toBe(1)
	expect(await remaining()).toEqual(['a/writing.webp'])
})

test('carries on when files disappear underneath it', async () => {
	const goneBeforeStat = await cached('a/1.webp', 100, 5 * HOUR)
	const goneBeforeDelete = await cached('a/2.webp', 100, 4 * HOUR)
	await cached('a/3.webp', 100, 3 * HOUR)
	await cached('a/4.webp', 100, 2 * HOUR)
	const result = await pruneImageCache({
		dir,
		maxBytes: 100,
		now: NOW,
		fs: {
			readdir: fs.readdir,
			async stat(file) {
				if (file === goneBeforeStat) await fs.rm(file)
				return fs.stat(file)
			},
			async unlink(file) {
				if (file === goneBeforeDelete) await fs.rm(file)
				return fs.unlink(file)
			},
		},
	})
	expect(await remaining()).toEqual(['a/4.webp'])
	expect(result.keptBytes).toBe(100)
})

function denied(code: 'EACCES' | 'EPERM') {
	return Object.assign(new Error(`${code}: not allowed`), { code })
}

test('skips and counts a folder it cannot read, and prunes the rest', async () => {
	const locked = path.join(dir, 'locked')
	await cached('locked/1.webp', 100, 9 * HOUR)
	await cached('open/2.webp', 100, 5 * HOUR)
	await cached('open/3.webp', 100, 2 * HOUR)
	const result = await pruneImageCache({
		dir,
		maxBytes: 100,
		now: NOW,
		fs: {
			async readdir(folder, options) {
				if (folder === locked) throw denied('EACCES')
				return fs.readdir(folder, options)
			},
			stat: fs.stat,
			unlink: fs.unlink,
		},
	})
	expect(result).toEqual({
		removedFiles: 1,
		removedBytes: 100,
		keptBytes: 100,
		skipped: 1,
	})
	expect(await remaining()).toEqual(['locked/1.webp', 'open/3.webp'])
})

test('skips and counts files it may not stat or delete, and moves on to the next oldest', async () => {
	const noStat = await cached('a/1.webp', 100, 9 * HOUR)
	const noDelete = await cached('a/2.webp', 100, 8 * HOUR)
	await cached('a/3.webp', 100, 7 * HOUR)
	await cached('a/4.webp', 100, 2 * HOUR)
	const result = await pruneImageCache({
		dir,
		maxBytes: 200,
		now: NOW,
		fs: {
			readdir: (folder, options) => fs.readdir(folder, options),
			async stat(file) {
				if (file === noStat) throw denied('EPERM')
				return fs.stat(file)
			},
			async unlink(file) {
				if (file === noDelete) throw denied('EACCES')
				return fs.unlink(file)
			},
		},
	})
	// 2 and 4 are left (200 bytes counted); 1 was never counted.
	expect(result).toEqual({
		removedFiles: 1,
		removedBytes: 100,
		keptBytes: 200,
		skipped: 2,
	})
	expect(await remaining()).toEqual(['a/1.webp', 'a/2.webp', 'a/4.webp'])
})

test('removing a photo’s resizes is fine when nothing was cached', async () => {
	await expect(
		removeCachedResizes('users/u/recipes/r/images/a.png', {
			dir: path.join(dir, 'missing'),
		}),
	).resolves.toBe(0)
})
