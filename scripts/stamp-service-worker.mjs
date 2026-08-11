import { readdir } from 'node:fs/promises'
import path from 'node:path'

const clientBuildDirectory = path.resolve('build/client')
const assetsDirectory = path.join(clientBuildDirectory, 'assets')
const serviceWorkerPath = path.join(clientBuildDirectory, 'sw.js')
const assetPathsToken = "'__QM_CLIENT_ASSET_PATHS__'"

const assetPaths = (await readdir(assetsDirectory))
	.sort()
	.map((file) => `/assets/${file}`)
const serviceWorker = await Bun.file(serviceWorkerPath).text()
const tokenOccurrences = serviceWorker.split(assetPathsToken).length - 1

if (tokenOccurrences !== 1) {
	throw new Error(
		`Expected one ${assetPathsToken} token in the built service worker, found ${tokenOccurrences}`,
	)
}

await Bun.write(
	serviceWorkerPath,
	serviceWorker.replace(
		assetPathsToken,
		assetPaths.map((assetPath) => JSON.stringify(assetPath)).join(',\n\t'),
	),
)

console.log(`Embedded ${assetPaths.length} client assets in the service worker`)
