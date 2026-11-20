import { promises as fs, constants, existsSync } from 'node:fs'
import { invariant, invariantResponse } from '@epic-web/invariant'
import { getDefaultSharpPipeline, getImgResponse } from 'openimg/node'
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

// The largest edge the app ever asks for is the 1200px share image; this
// leaves headroom while keeping one resize well inside the machine's memory.
const MAX_EDGE = 3000

function parseEdge(value: string | null) {
	if (value === null) return true
	if (!/^\d+$/.test(value)) return false
	const edge = Number(value)
	return edge >= 1 && edge <= MAX_EDGE
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const searchParams = url.searchParams

	// The app only ever asks for stored Recipe photos by objectKey. Serving
	// `src` paths from disk or other sites let an anonymous request hand sharp
	// any file in public/ (a non-image crashed the process) or make the server
	// fetch a URL of the caller's choosing.
	const objectKey = searchParams.get('objectKey')
	invariantResponse(objectKey, 'objectKey query parameter is required', {
		status: 400,
	})
	invariantResponse(
		parseEdge(searchParams.get('w')) && parseEdge(searchParams.get('h')),
		`Width and height must be whole numbers from 1 to ${MAX_EDGE}`,
		{ status: 400 },
	)

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

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
		// Only the storage endpoint, never an origin taken from request headers.
		allowlistedOrigins: process.env.AWS_ENDPOINT_URL_S3
			? [new URL(process.env.AWS_ENDPOINT_URL_S3).origin]
			: [],
		cacheFolder: await getCacheDir(),
		getImgSource: () => {
			// In MOCKS mode the storage "bucket" is a local folder, so read it
			// directly. Routing through the mocked fetch hands openimg a stream
			// sharp can't consume under bun.
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
		},
	})
}
