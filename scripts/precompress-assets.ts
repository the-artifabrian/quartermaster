// Writes a .br and a .gz twin next to every compressible client asset so the
// server can send a stored file instead of compressing each hashed asset again
// on every request (server/precompressed.ts picks the twin up). Runs after
// stamp-service-worker.mjs, which also skips the twins by name.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const assetsDirectory = path.resolve('build/client/assets')
const compressible = /\.(js|css|svg|json|txt|html|xml|map)$/
// Below this size the compression middleware never compressed either.
const minimumBytes = 1024

const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

const names = (await readdir(assetsDirectory)).filter(
	(name) => compressible.test(name) && !/\.(br|gz)$/.test(name),
)
const results = await Promise.all(
	names.map(async (name) => {
		const file = path.join(assetsDirectory, name)
		if ((await stat(file)).size < minimumBytes) return null
		const source = await readFile(file)
		const [br, gz] = await Promise.all([
			brotli(source, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
					[constants.BROTLI_PARAM_SIZE_HINT]: source.length,
				},
			}),
			gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
		])
		await Promise.all([
			writeFile(`${file}.br`, br),
			writeFile(`${file}.gz`, gz),
		])
		return { source: source.length, br: br.length, gz: gz.length }
	}),
)
const written = results.filter((result) => result !== null)
const sum = (key: 'source' | 'br' | 'gz') =>
	written.reduce((total, result) => total + result[key], 0)
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`
console.log(
	`precompressed ${written.length} assets: ${kb(sum('source'))} → ${kb(sum('br'))} brotli, ${kb(sum('gz'))} gzip`,
)
