/**
 * What a Recipe photo may cost to decode, and the queue every sharp job on
 * one waits in. The production machine has 512 MB and one CPU, with about
 * 90 to 165 MB free while the app runs, so the limits below are about the
 * memory a decode holds, not the size of the file.
 *
 * Decoded size is width × height × channels × bytes per sample. The extra
 * memory one job held over a bare process, measured on macOS under Node and Bun with
 * one libvips thread (as on one CPU), for the route's resizes, its 2048 px
 * copy and the upload check:
 * - a baseline JPEG shrinks while it loads: a rotated 48 MP one, 146 MB
 *   decoded, held at most 45 MB
 * - a plain PNG streams: 100 MB decoded held at most 85 MB
 * - a progressive JPEG, an interlaced PNG and a WebP decode whole: 32 MB
 *   decoded held at most 85 MB, and 100 MB of interlaced PNG up to 165 MB
 * Two jobs at once added up, so jobs take turns.
 */
/** A baseline JPEG: a 48 MP phone photo fits. */
export const MAX_JPEG_DECODED_BYTES = 150 * 1024 * 1024
/** A PNG that isn't interlaced. */
export const MAX_DECODED_BYTES = 100 * 1024 * 1024
/** A progressive JPEG, an interlaced PNG or a WebP, which decode whole. */
export const MAX_WHOLE_DECODED_BYTES = 32 * 1024 * 1024

/**
 * sharp's own pixel limit, as a backstop for any call that skips the check
 * below: a pixel takes at least one byte, so it never refuses a photo the
 * decoded-size check passes.
 */
export const PHOTO_SHARP_OPTIONS = { limitInputPixels: MAX_JPEG_DECODED_BYTES }

/** A sharp job on a photo that runs longer than this is stopped. */
export const PHOTO_JOB_SECONDS = 30

/** How long a job waits for its turn before it gives up. */
const PHOTO_QUEUE_WAIT_MS = 30_000

const BYTES_PER_SAMPLE: Record<string, number> = {
	uchar: 1,
	char: 1,
	ushort: 2,
	short: 2,
	uint: 4,
	int: 4,
	float: 4,
	double: 8,
	complex: 8,
	dpcomplex: 16,
}

type DecodeMetadata = {
	format?: string
	width?: number
	height?: number
	channels?: number
	depth?: string
	isProgressive?: boolean
}

/** The memory a full decode of an image with this header would take. */
export function decodedBytes({
	width,
	height,
	channels,
	depth,
}: DecodeMetadata) {
	if (!width || !height || !channels) return Infinity
	return width * height * channels * (BYTES_PER_SAMPLE[depth ?? ''] ?? 16)
}

function decodeLimit({ format, isProgressive }: DecodeMetadata) {
	if (isProgressive || format === 'webp') return MAX_WHOLE_DECODED_BYTES
	if (format === 'jpeg') return MAX_JPEG_DECODED_BYTES
	return MAX_DECODED_BYTES
}

/** Whether an image with this header costs more to decode than a photo may. */
export function isTooBigToDecode(metadata: DecodeMetadata) {
	return decodedBytes(metadata) > decodeLimit(metadata)
}

/** A photo job waited longer than its turn allows. */
export class PhotoQueueTimeout extends Error {
	constructor() {
		super('Waited too long for a turn to process a photo')
	}
}

const PHOTO_SLOTS = 1
let runningJobs = 0
const waitingJobs: Array<() => void> = []

function takeSlot(signal: AbortSignal | undefined, waitMs: number) {
	if (runningJobs < PHOTO_SLOTS && waitingJobs.length === 0) {
		runningJobs++
		return Promise.resolve()
	}
	return new Promise<void>((resolve, reject) => {
		const stopWaiting = () => {
			clearTimeout(timer)
			signal?.removeEventListener('abort', onAbort)
			const index = waitingJobs.indexOf(start)
			if (index !== -1) waitingJobs.splice(index, 1)
		}
		const start = () => {
			stopWaiting()
			runningJobs++
			resolve()
		}
		const onAbort = () => {
			stopWaiting()
			reject(signal?.reason ?? new Error('The request was aborted'))
		}
		const timer = setTimeout(() => {
			stopWaiting()
			reject(new PhotoQueueTimeout())
		}, waitMs)
		if (signal?.aborted) return onAbort()
		signal?.addEventListener('abort', onAbort, { once: true })
		waitingJobs.push(start)
	})
}

function giveBackSlot() {
	runningJobs--
	waitingJobs[0]?.()
}

/**
 * Run a sharp job on a photo once no other one is running, so overlapping
 * requests queue instead of adding up their memory. A job that waits longer
 * than `waitMs`, or whose request is aborted while it waits, never runs.
 */
export async function withPhotoSlot<T>(
	job: () => Promise<T>,
	{
		signal,
		waitMs = PHOTO_QUEUE_WAIT_MS,
	}: { signal?: AbortSignal; waitMs?: number } = {},
): Promise<T> {
	await takeSlot(signal, waitMs)
	try {
		return await job()
	} finally {
		giveBackSlot()
	}
}

/** The photo field's reply to a file the check below refuses. */
export const PHOTO_REFUSALS = {
	unusable: 'We can’t use that file. Choose a JPG, PNG or WebP.',
	'too-big': 'That photo is too big. Try a smaller one.',
	busy: 'We couldn’t check that photo just now. Try again.',
} as const

export type PhotoRefusal = keyof typeof PHOTO_REFUSALS

/** The formats the Recipe form offers, by sharp's name for each. */
const PHOTO_FORMATS = {
	jpeg: { type: 'image/jpeg', extension: 'jpg' },
	png: { type: 'image/png', extension: 'png' },
	webp: { type: 'image/webp', extension: 'webp' },
} as const

type PhotoFormat = keyof typeof PHOTO_FORMATS
type PhotoType = (typeof PHOTO_FORMATS)[PhotoFormat]['type']

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
	return signature.every((byte, index) => bytes[offset + index] === byte)
}

function sniffFormat(bytes: Uint8Array): PhotoFormat | null {
	// No photo is this short, and WebP's signature runs to the 12th byte.
	if (bytes.length < 12) return null
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
	if (startsWith(bytes, PNG_SIGNATURE)) return 'png'
	// RIFF, a four-byte length, then WEBP.
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		return 'webp'
	}
	return null
}

/**
 * The media type the first bytes of a file say it is, when that is one the
 * app accepts: JPEG, PNG or WebP. The browser's own type is not trusted.
 */
export function sniffImageType(bytes: Uint8Array): PhotoType | null {
	const format = sniffFormat(bytes)
	return format ? PHOTO_FORMATS[format].type : null
}

declare const checked: unique symbol

/** A photo that passed `checkRecipePhoto`, the only thing storage accepts. */
export type CheckedRecipePhoto = {
	readonly bytes: Uint8Array<ArrayBuffer>
	readonly type: PhotoType
	readonly extension: (typeof PHOTO_FORMATS)[PhotoFormat]['extension']
	readonly [checked]: true
}

export type PhotoCheck =
	{ ok: true; photo: CheckedRecipePhoto } | { ok: false; reason: PhotoRefusal }

/**
 * Whether an uploaded file is a photo the image route will be able to show,
 * and if so its bytes with the type they really have.
 *
 * Its first bytes must be JPEG, PNG or WebP. sharp must read the same format
 * from its header, within the decoded-size limits above, and then decode the
 * whole file to a thumbnail: a JPEG cut off partway still has a readable
 * header. HEIC is refused by its first bytes.
 */
export async function checkRecipePhoto(
	file: Blob,
	{ signal }: { signal?: AbortSignal } = {},
): Promise<PhotoCheck> {
	const bytes = new Uint8Array(await file.arrayBuffer())
	const format = sniffFormat(bytes)
	if (!format) return { ok: false, reason: 'unusable' }
	const { default: sharp } = await import('sharp')
	// The header alone, so no limit is needed to read it.
	const metadata = await sharp(bytes, { limitInputPixels: false })
		.metadata()
		.catch(() => null)
	if (metadata?.format !== format) return { ok: false, reason: 'unusable' }
	if (isTooBigToDecode(metadata)) return { ok: false, reason: 'too-big' }
	try {
		await withPhotoSlot(
			() =>
				sharp(bytes, PHOTO_SHARP_OPTIONS)
					.timeout({ seconds: PHOTO_JOB_SECONDS })
					.resize(32, 32, { fit: 'inside' })
					.toBuffer(),
			{ signal },
		)
	} catch (error) {
		if (error instanceof PhotoQueueTimeout) return { ok: false, reason: 'busy' }
		return { ok: false, reason: 'unusable' }
	}
	return {
		ok: true,
		photo: { bytes, ...PHOTO_FORMATS[format] } as CheckedRecipePhoto,
	}
}
