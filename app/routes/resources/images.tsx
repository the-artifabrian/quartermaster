import { invariant, invariantResponse } from '@epic-web/invariant'
import { getImgResponse } from 'openimg/node'
import { Duplex } from 'node:stream'
import sharp, { type Sharp } from 'sharp'
import {
	getImageCacheDir,
	getStoredImageSource,
} from '#app/utils/image-cache.server.ts'
import { isRecipeImageKey, snapImageSize } from '#app/utils/image-route.ts'
import {
	isTooBigToDecode,
	PHOTO_JOB_SECONDS,
	PHOTO_SHARP_OPTIONS,
	withPhotoSlot,
} from '#app/utils/recipe-photo.server.ts'
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
 * (see snapImageSize) in AVIF, WebP or the original format, so a photo has
 * at most 21 cached resizes, none larger than 1200×630, plus one copy of at
 * most 2048 px for the data export. Uploads are capped at 3 MB.
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
	// Share links ask for `cover`, which is also what sharp does with no fit,
	// so openimg never sees a fit and both land on one cached copy.
	invariantResponse(
		parseOption(searchParams.get('fit'), ['cover']) !== null,
		'Fit must be cover',
		{ status: 400 },
	)

	if (width === undefined && height === undefined) {
		// The data export links to the photo in its own format, at most
		// ORIGINAL_MAX_EDGE. No page asks for that size as AVIF or WebP, so
		// the route doesn't make one.
		invariantResponse(
			format === undefined,
			'A format needs a width and a height',
			{ status: 400 },
		)
		return { format }
	}
	return { ...snapImageSize({ width, height }), format }
}

type ImgParams = ReturnType<typeof getImgParams>

/**
 * The longest edge of the photo served with no size, which the data export
 * links to. It is upright and has no metadata, since storage keeps the
 * upload's own bytes and those can carry the place a photo was taken.
 */
export const ORIGINAL_MAX_EDGE = 2048

/**
 * openimg pipes the stored photo through what this returns and waits for an
 * `info` event, as from a sharp instance. sharp keeps a streamed input in
 * memory anyway, so this collects the bytes, reads the header, and refuses
 * a photo that costs more to decode than an upload may. The decode then
 * waits its turn with every other photo job, so overlapping requests queue
 * instead of adding up their memory.
 *
 * sharp's default AVIF effort (4) spends 250 ms per Recipe photo here and a
 * few seconds on the production machine, which is what a Recipe page waits
 * for on its first view after an import. Effort 1 encodes the same quality
 * target in a fraction of the time for ~8% more bytes.
 */
function photoTransform(params: ImgParams, signal: AbortSignal) {
	const chunks: Array<Buffer> = []
	return new Duplex({
		write(chunk: Buffer, _encoding, callback) {
			chunks.push(chunk)
			callback()
		},
		final(callback) {
			const bytes = Buffer.concat(chunks)
			chunks.length = 0
			transform(bytes, params, signal).then(
				({ data, info }) => {
					this.emit('info', info)
					this.push(data)
					this.push(null)
					callback()
				},
				(error: Error) => callback(error),
			)
		},
		read() {},
	})
}

async function transform(
	bytes: Buffer,
	params: ImgParams,
	signal: AbortSignal,
) {
	const metadata = await sharp(bytes, { limitInputPixels: false }).metadata()
	if (isTooBigToDecode(metadata)) {
		throw new Error('The stored photo is over the decoded-size limit')
	}
	return withPhotoSlot(
		() => {
			const pipeline = sharp(bytes, PHOTO_SHARP_OPTIONS)
				.timeout({ seconds: PHOTO_JOB_SECONDS })
				.autoOrient()
			if (params.format === 'avif') pipeline.avif({ effort: 1 })
			if (params.format === 'webp') pipeline.webp()
			if ('width' in params) {
				pipeline.resize(params.width, params.height)
			} else {
				pipeline.resize(ORIGINAL_MAX_EDGE, ORIGINAL_MAX_EDGE, {
					fit: 'inside',
					withoutEnlargement: true,
				})
			}
			return pipeline.toBuffer({ resolveWithObject: true })
		},
		{ signal },
	)
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
	// Serves only keys the app writes (see isRecipeImageKey).
	invariantResponse(isRecipeImageKey(objectKey), 'Invalid object key', {
		status: 400,
	})
	const params = getImgParams(searchParams)

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

	return getImgResponse(request, {
		headers,
		getImgParams: () => params,
		// The cache key stays the source's own, as openimg's default pipeline
		// keys it, so the resizes already on disk keep serving.
		getSharpPipeline: ({ source }) => {
			// getImgSource below only ever answers with a file or a fetch.
			invariant(source.type !== 'data', 'Unexpected data image source')
			return {
				// Used as openimg uses a sharp instance: piped into, then read.
				pipeline: photoTransform(params, request.signal) as unknown as Sharp,
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
