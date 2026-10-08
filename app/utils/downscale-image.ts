import { useCallback, useRef, useState } from 'react'

/** The longest edge, in pixels, of a photo the browser has re-encoded. */
export const MAX_DOWNSCALED_EDGE = 2048

const SHRINK_STEPS = [1, 0.75, 0.55, 0.4, 0.3]
const JPEG_QUALITY = 0.85

type DecodedImage = {
	width: number
	height: number
	toJpeg(width: number, height: number): Promise<Blob>
	close(): void
}

export type DecodeImage = (file: Blob) => Promise<DecodedImage>

/**
 * Shrink a chosen photo in the browser until it fits `maxBytes`.
 *
 * A phone photo is often larger than the upload limit. The photo comes back
 * untouched when it already fits, when the browser cannot decode it, or when
 * no smaller size fits either, so the server's size check can explain it.
 */
export async function downscaleImageToFit(
	file: File,
	maxBytes: number,
	decode: DecodeImage = decodeInBrowser,
): Promise<File> {
	if (file.size <= maxBytes || !file.type.startsWith('image/')) return file

	let image: DecodedImage
	try {
		image = await decode(file)
	} catch {
		return file
	}

	try {
		const fit = Math.min(
			1,
			MAX_DOWNSCALED_EDGE / Math.max(image.width, image.height),
		)
		for (const step of SHRINK_STEPS) {
			const width = Math.max(1, Math.round(image.width * fit * step))
			const height = Math.max(1, Math.round(image.height * fit * step))
			const blob = await image.toJpeg(width, height)
			if (blob.size <= maxBytes) {
				return new File([blob], jpegName(file.name), {
					type: 'image/jpeg',
					lastModified: file.lastModified,
				})
			}
		}
		return file
	} catch {
		return file
	} finally {
		image.close()
	}
}

function jpegName(name: string) {
	const dot = name.lastIndexOf('.')
	return `${dot > 0 ? name.slice(0, dot) : name}.jpg`
}

async function decodeInBrowser(file: Blob): Promise<DecodedImage> {
	const bitmap = await createImageBitmap(file, {
		imageOrientation: 'from-image',
	})
	return {
		width: bitmap.width,
		height: bitmap.height,
		async toJpeg(width, height) {
			const canvas = document.createElement('canvas')
			canvas.width = width
			canvas.height = height
			const context = canvas.getContext('2d')
			if (!context) throw new Error('Canvas is unavailable')
			// JPEG has no transparency; a PNG's clear pixels would turn black.
			context.fillStyle = '#ffffff'
			context.fillRect(0, 0, width, height)
			context.drawImage(bitmap, 0, 0, width, height)
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
			)
			if (!blob) throw new Error('Could not encode the photo')
			return blob
		},
		close() {
			bitmap.close()
		},
	}
}

/**
 * Shrinks the photos chosen on a file input so each fits `maxBytes`.
 *
 * `fit(input)` replaces the input's files with ones that fit, and resolves
 * false when a later pick has superseded it, so a slow first photo never
 * overwrites a second one. `preparing` is true until the latest pick is ready.
 * Setting `files` does not fire another change event.
 */
export function useFitFileInput(
	maxBytes: number,
	decode: DecodeImage = decodeInBrowser,
) {
	const latest = useRef(0)
	const [preparing, setPreparing] = useState(false)

	const fit = useCallback(
		async (input: HTMLInputElement) => {
			const call = ++latest.current
			setPreparing(true)
			try {
				const chosen = Array.from(input.files ?? [])
				const fitted = await Promise.all(
					chosen.map((file) => downscaleImageToFit(file, maxBytes, decode)),
				)
				if (call !== latest.current) return false
				if (fitted.some((file, index) => file !== chosen[index])) {
					const transfer = new DataTransfer()
					for (const file of fitted) transfer.items.add(file)
					input.files = transfer.files
				}
				return true
			} finally {
				if (call === latest.current) setPreparing(false)
			}
		},
		[maxBytes, decode],
	)

	return { preparing, fit }
}
