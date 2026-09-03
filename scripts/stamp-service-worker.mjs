import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const clientBuildDirectory = path.resolve('build/client')
const serverBuildDirectory = path.resolve('build/server')
const assetsDirectory = path.join(clientBuildDirectory, 'assets')
const serviceWorkerPath = path.join(clientBuildDirectory, 'sw.js')
const webmanifestPath = path.join(clientBuildDirectory, 'site.webmanifest')
const assetPathsToken = "'__QM_CLIENT_ASSET_PATHS__'"
const startUrlToken = "'__QM_START_URL__'"
const cacheVersionToken = "'__QM_CACHE_VERSION__'"

async function listFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (
		await Promise.all(
			entries.map(async (entry) => {
				const entryPath = path.join(directory, entry.name)
				if (entry.isDirectory()) return listFiles(entryPath)
				return entry.isFile() ? [entryPath] : []
			}),
		)
	).flat()
}

function replaceExactlyOnce(source, token, replacement) {
	const occurrences = source.split(token).length - 1
	if (occurrences !== 1) {
		throw new Error(
			`Expected one ${token} token in the built service worker, found ${occurrences}`,
		)
	}
	return source.replace(token, replacement)
}

function isServiceWorkerPublicAsset(relativePath) {
	return (
		relativePath === 'favicon.ico' ||
		relativePath === 'site.webmanifest' ||
		relativePath.startsWith('favicons/') ||
		relativePath.startsWith('splash/')
	)
}

const assetPaths = (await listFiles(assetsDirectory))
	.map((file) => path.relative(assetsDirectory, file).split(path.sep).join('/'))
	.sort()
	.map((file) => `/assets/${file}`)
const publicFiles = (await listFiles(clientBuildDirectory))
	.map((file) => ({
		file,
		relativePath: path
			.relative(clientBuildDirectory, file)
			.split(path.sep)
			.join('/'),
	}))
	.filter(
		({ relativePath }) =>
			relativePath !== 'sw.js' && isServiceWorkerPublicAsset(relativePath),
	)
	.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
const serverFiles = (await listFiles(serverBuildDirectory)).sort()
let serviceWorker = await Bun.file(serviceWorkerPath).text()
const cacheVersionHash = createHash('sha256')
cacheVersionHash.update(serviceWorker)
for (const assetPath of assetPaths) {
	cacheVersionHash.update(assetPath)
	cacheVersionHash.update('\0')
}
for (const { file, relativePath } of publicFiles) {
	cacheVersionHash.update(relativePath)
	cacheVersionHash.update('\0')
	cacheVersionHash.update(new Uint8Array(await Bun.file(file).arrayBuffer()))
}
for (const file of serverFiles) {
	cacheVersionHash.update(path.relative(serverBuildDirectory, file))
	cacheVersionHash.update('\0')
	cacheVersionHash.update(new Uint8Array(await Bun.file(file).arrayBuffer()))
}
const cacheVersion = cacheVersionHash.digest('hex').slice(0, 12)
const webmanifest = JSON.parse(await Bun.file(webmanifestPath).text())
const startUrl = webmanifest.start_url

if (
	typeof startUrl !== 'string' ||
	!startUrl.startsWith('/') ||
	startUrl.startsWith('//')
) {
	throw new Error('site.webmanifest start_url must be a root-relative string')
}

serviceWorker = replaceExactlyOnce(
	serviceWorker,
	assetPathsToken,
	assetPaths.map((assetPath) => JSON.stringify(assetPath)).join(',\n\t'),
)
serviceWorker = replaceExactlyOnce(
	serviceWorker,
	startUrlToken,
	JSON.stringify(startUrl),
)
serviceWorker = replaceExactlyOnce(
	serviceWorker,
	cacheVersionToken,
	JSON.stringify(cacheVersion),
)

await Bun.write(serviceWorkerPath, serviceWorker)

console.log(
	`Embedded ${assetPaths.length} client assets, cache generation ${cacheVersion}, and start URL ${startUrl} in the service worker`,
)
