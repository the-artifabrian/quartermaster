import { promises as fs, constants, existsSync } from 'node:fs'
import { invariant, invariantResponse } from '@epic-web/invariant'
import { getDefaultSharpPipeline, getImgResponse } from 'openimg/node'
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
		// sharp's default AVIF effort (4) spends 250 ms per Recipe photo here and
		// a few seconds on the production machine, which is what a Recipe page
		// waits for on its first view after an import. Effort 1 encodes the same
		// quality target in a fraction of the time for ~8% more bytes. The cache
		// key stays the source's own, so the AVIFs already on disk keep serving.
		getSharpPipeline: ({ params, source }) => {
			if (params.format !== 'avif') return undefined
			// getImgSource below only ever answers with a file or a fetch.
			invariant(source.type !== 'data', 'Unexpected data image source')
			return {
				pipeline: getDefaultSharpPipeline(params).avif({ effort: 1 }),
				cacheKey: source.type === 'fetch' ? source.url : source.path,
			}
		},
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
			// A filesystem path never climbs out of the folder it names.
			invariantResponse(!src.includes('..'), 'Invalid src', { status: 400 })
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
