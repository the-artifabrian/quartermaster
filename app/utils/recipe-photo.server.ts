/**
 * The most pixels a Recipe photo may have: checked at upload, and again by
 * the image route before it decodes a stored photo.
 *
 * 25M px clears a 24 MP phone photo (5712×4284). Bigger photos are well over
 * the 3 MB upload limit, so the form shrinks them to 2048 px on the long edge
 * before they are sent. The limit is set by the image route's full-size copy:
 * a rotated JPEG at the cap peaks around 310 MB there, and one of 60M px
 * around 650 MB, more than the production machine has.
 */
export const MAX_PHOTO_PIXELS = 25_000_000

/** The options every sharp call on a Recipe photo starts from. */
export const PHOTO_SHARP_OPTIONS = { limitInputPixels: MAX_PHOTO_PIXELS }

/** The form's reply to a file the check below refuses. */
export const UNUSABLE_PHOTO_MESSAGE =
	'That file isn’t a photo we can use. Choose a JPG, PNG or WebP.'

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

/**
 * Whether an uploaded file is a photo the image route will be able to show,
 * and if so its bytes with the type they really have.
 *
 * Its first bytes must be JPEG, PNG or WebP. sharp must then read the same
 * format with no more than `MAX_PHOTO_PIXELS`, and decode the whole file to
 * a thumbnail: a JPEG cut off partway still has a readable header. An
 * iPhone's HEIC is refused here, since this sharp build can't decode it.
 */
export async function checkRecipePhoto(
	file: Blob,
): Promise<CheckedRecipePhoto | null> {
	const bytes = new Uint8Array(await file.arrayBuffer())
	const format = sniffFormat(bytes)
	if (!format) return null
	const { default: sharp } = await import('sharp')
	try {
		const metadata = await sharp(bytes, PHOTO_SHARP_OPTIONS).metadata()
		if (metadata.format !== format) return null
		await sharp(bytes, PHOTO_SHARP_OPTIONS)
			.resize(32, 32, { fit: 'inside' })
			.toBuffer()
	} catch {
		return null
	}
	return { bytes, ...PHOTO_FORMATS[format] } as CheckedRecipePhoto
}
