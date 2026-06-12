import { promises as fs, constants, existsSync } from 'node:fs'
import { invariantResponse } from '@epic-web/invariant'
import { getImgResponse } from 'openimg/node'
import { getDomainUrl } from '#app/utils/misc.tsx'
import { getSignedGetRequestInfo } from '#app/utils/storage.server.ts'
import { type Route } from './+types/images'

let cacheDir: string | null = null

async function getCacheDir() {
	if (cacheDir) return cacheDir

	let dir = './tests/fixtures/openimg'
	if (process.env.NODE_ENV === 'production') {
		const isAccessible = await fs
			.access('/data', constants.W_OK)
			.then(() => true)
			.catch(() => false)

		if (isAccessible) {
			dir = '/data/images'
		}
	}

	return (cacheDir = dir)
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const searchParams = url.searchParams

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

	const objectKey = searchParams.get('objectKey')

	return getImgResponse(request, {
		headers,
		allowlistedOrigins: [
			getDomainUrl(request),
			process.env.AWS_ENDPOINT_URL_S3,
		].filter(Boolean),
		cacheFolder: await getCacheDir(),
		getImgSource: () => {
			if (objectKey) {
				// In MOCKS mode the storage "bucket" is a local folder, so read it
				// directly. Routing through the mocked fetch hands openimg a stream
				// sharp can't consume under bun — the resulting async error escapes
				// the request as an uncaughtException and takes down the dev server.
				if (process.env.MOCKS === 'true') {
					invariantResponse(!objectKey.includes('..'), 'Invalid object key', {
						status: 400,
					})
					const fixturePath = `./tests/fixtures/images/${objectKey}`
					const uploadedPath = `./tests/fixtures/uploaded/${objectKey}`
					return {
						type: 'fs',
						path: existsSync(fixturePath) ? fixturePath : uploadedPath,
					}
				}
				const { url: signedUrl, headers: signedHeaders } =
					getSignedGetRequestInfo(objectKey)
				return {
					type: 'fetch',
					url: signedUrl,
					headers: signedHeaders,
				}
			}

			const src = searchParams.get('src')
			invariantResponse(src, 'src query parameter is required', { status: 400 })

			if (URL.canParse(src)) {
				// Fetch image from external URL; will be matched against allowlist
				return {
					type: 'fetch',
					url: src,
				}
			}
			// Retrieve image from filesystem (public folder)
			if (src.startsWith('/assets')) {
				// Files managed by Vite
				return {
					type: 'fs',
					path: '.' + src,
				}
			}
			// Fallback to files in public folder
			return {
				type: 'fs',
				path: './public' + src,
			}
		},
	})
}
