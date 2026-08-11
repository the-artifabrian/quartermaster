import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const clientBuildDirectory = path.resolve('build/client')
const assetsDirectory = path.join(clientBuildDirectory, 'assets')
const serviceWorkerPath = path.join(clientBuildDirectory, 'sw.js')
const webmanifestPath = path.join(clientBuildDirectory, 'site.webmanifest')
const assetPathsToken = "'__QM_CLIENT_ASSET_PATHS__'"
const startUrlToken = "'__QM_START_URL__'"
const publicAssetVersionToken = "'__QM_PUBLIC_ASSET_VERSION__'"

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
const publicAssetHash = createHash('sha256')
for (const { file, relativePath } of publicFiles) {
	publicAssetHash.update(relativePath)
	publicAssetHash.update('\0')
	publicAssetHash.update(new Uint8Array(await Bun.file(file).arrayBuffer()))
}
const publicAssetVersion = publicAssetHash.digest('hex').slice(0, 12)
const webmanifest = JSON.parse(await Bun.file(webmanifestPath).text())
const startUrl = webmanifest.start_url

if (
	typeof startUrl !== 'string' ||
	!startUrl.startsWith('/') ||
	startUrl.startsWith('//')
) {
	throw new Error('site.webmanifest start_url must be a root-relative string')
}

let serviceWorker = await Bun.file(serviceWorkerPath).text()
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
	publicAssetVersionToken,
	JSON.stringify(publicAssetVersion),
)

await Bun.write(serviceWorkerPath, serviceWorker)

console.log(
	`Embedded ${assetPaths.length} client assets, public generation ${publicAssetVersion}, and start URL ${startUrl} in the service worker`,
)
