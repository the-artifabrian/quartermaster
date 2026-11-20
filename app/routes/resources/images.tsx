import { invariant, invariantResponse } from '@epic-web/invariant'
import { getDefaultSharpPipeline, getImgResponse } from 'openimg/node'
import {
	getImageCacheDir,
	getStoredImageSource,
} from '#app/utils/image-cache.server.ts'
import { isRecipeImageKey, snapImageSize } from '#app/utils/image-route.ts'
import { type Route } from './+types/images'

function parseEdge(value: string | null) {
	if (value === null) return undefined
	if (!/^[1-9]\d*$/.test(value)) return null
	return Number(value)
}

function parseOption<T extends string>(
	value: string | null,
	allowed: ReadonlyArray<T>,
) {
	if (value === null) return undefined
	return allowed.find((option) => option === value) ?? null
}

/**
 * The resize openimg makes and caches. Every request lands on a listed size
 * (see snapImageSize), in a format and fit the pages ask for, so the cache
 * holds a bounded set of copies per photo however the URL is varied.
 */
function getImgParams(searchParams: URLSearchParams) {
	const width = parseEdge(searchParams.get('w'))
	const height = parseEdge(searchParams.get('h'))
	invariantResponse(
		width !== null && height !== null,
		'Width and height must be positive whole numbers',
		{ status: 400 },
	)
	const format = parseOption(searchParams.get('format'), ['avif', 'webp'])
	invariantResponse(format !== null, 'Format must be avif or webp', {
		status: 400,
	})
	const fit = parseOption(searchParams.get('fit'), ['cover'])
	invariantResponse(fit !== null, 'Fit must be cover', { status: 400 })

	if (width === undefined && height === undefined) {
		// The data export links to the original. Nothing asks for a full-size
		// re-encode, which is the slowest thing the route could be made to do.
		invariantResponse(
			format === undefined,
			'A format needs a width and a height',
			{ status: 400 },
		)
		return { format, fit }
	}
	return { ...snapImageSize({ width, height }), format, fit }
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
	// Only keys of the shape the app writes, so a request can't reach other
	// objects in the bucket or other files on disk in MOCKS mode.
	invariantResponse(isRecipeImageKey(objectKey), 'Invalid object key', {
		status: 400,
	})
	const params = getImgParams(searchParams)

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

	return getImgResponse(request, {
		headers,
		getImgParams: () => params,
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
		cacheFolder: await getImageCacheDir(),
		getImgSource: () => getStoredImageSource(objectKey),
	})
}
