/**
 * Reading a response body from a server we don't control needs a deadline and
 * a size limit that cover the body, not just the headers. A server can send
 * its headers promptly and then drip the body, and a small compressed body can
 * decode to far more than its Content-Length says.
 */

export class BodyTooLargeError extends Error {
	constructor(maxBytes: number) {
		super(`The response body is larger than ${maxBytes} bytes.`)
		this.name = 'BodyTooLargeError'
	}
}

export class UnsupportedEncodingError extends Error {
	constructor(encoding: string) {
		super(`The response body is encoded as ${encoding}.`)
		this.name = 'UnsupportedEncodingError'
	}
}

/**
 * Bun's fetch decompresses a body eagerly on its HTTP thread, with no
 * backpressure, before any of it is read: about 1 MB of gzip that decodes to
 * 1 GiB takes gigabytes of memory. So a fetch whose body this module reads
 * passes `KEEP_BODY_ENCODED`, and under Bun the reader decodes the body only
 * as fast as it reads it. Node's fetch ignores `decompress` and decodes with
 * backpressure itself, so there the body must not be decoded again.
 */
const RUNNING_ON_BUN = typeof process.versions.bun === 'string'

/** Fetch init for a body `readBoundedText` will read. Node ignores it. */
export const KEEP_BODY_ENCODED = { decompress: false } as const

// Each Content-Encoding the reader decodes, and its DecompressionStream
// format. Node and Bun both implement 'brotli', which the DOM types omit.
const DECODERS = new Map([
	['gzip', 'gzip'],
	['br', 'brotli'],
]) as Map<string, CompressionFormat>

/** The Accept-Encoding header for a body `readBoundedText` will read. */
export const ACCEPT_ENCODING = [...DECODERS.keys()].join(', ')

/**
 * Reads the body as UTF-8 text, as `response.text()` does. Rejects with
 * `BodyTooLargeError` once more than `maxBytes` of body have arrived, encoded
 * or decoded, whatever Content-Length says, and with the signal's reason once
 * it aborts. `encoded` says whether the body still carries its
 * Content-Encoding. A Content-Encoding the reader cannot decode rejects with
 * `UnsupportedEncodingError` before any of the body is read.
 *
 * When it stops early it cancels the body stream, but that does not release
 * the connection in Bun: the caller must abort its fetch's signal for that.
 */
export async function readBoundedText(
	response: Response,
	{
		maxBytes,
		signal,
		encoded = RUNNING_ON_BUN,
	}: { maxBytes: number; signal: AbortSignal; encoded?: boolean },
): Promise<string> {
	// Not cancelled: Bun buffers a cancelled body that was never read into
	// memory. The caller's abort releases it.
	signal.throwIfAborted()
	if (!response.body) return ''
	let body: ReadableStream<Uint8Array> = response.body
	if (encoded) {
		const encoding = (response.headers.get('Content-Encoding') ?? 'identity')
			.trim()
			.toLowerCase()
		if (encoding !== 'identity') {
			const format = DECODERS.get(encoding)
			// Not cancelled, as above.
			if (!format) throw new UnsupportedEncodingError(encoding)
			// Decompression takes in its input with no backpressure, so an
			// endless encoded body would pile up ahead of the reader. An encoded
			// body is at most a few bytes longer than it decodes to, so the same
			// limit applies to it.
			let encodedBytes = 0
			const limitEncoded = new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					encodedBytes += chunk.byteLength
					if (encodedBytes > maxBytes) throw new BodyTooLargeError(maxBytes)
					controller.enqueue(chunk)
				},
			})
			// The DOM types have it take any BufferSource and so reject a byte
			// stream, although a Uint8Array is one.
			const decompress = new DecompressionStream(format) as TransformStream<
				Uint8Array,
				Uint8Array
			>
			body = body.pipeThrough(limitEncoded).pipeThrough(decompress)
		}
	}

	const reader = body.getReader()
	// Cancelling settles a pending read at once, even when the fetch would
	// keep waiting on a stalled body.
	const onAbort = () => void reader.cancel().catch(() => {})
	signal.addEventListener('abort', onAbort, { once: true })
	const decoder = new TextDecoder()
	let text = ''
	let bytes = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			signal.throwIfAborted()
			if (done) return text + decoder.decode()
			bytes += value.byteLength
			if (bytes > maxBytes) {
				reader.cancel().catch(() => {})
				throw new BodyTooLargeError(maxBytes)
			}
			text += decoder.decode(value, { stream: true })
		}
	} catch (error) {
		// A fetch that fails the body when its signal aborts uses its own error.
		if (signal.aborted) throw signal.reason
		throw error
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}
