import { brotliCompressSync, gzipSync } from 'node:zlib'
import { expect, test, vi } from 'vitest'
import {
	ACCEPT_ENCODING,
	BodyTooLargeError,
	readBoundedText,
	UnsupportedEncodingError,
} from './bounded-body.server.ts'

const LIMIT = 1024
const encoder = new TextEncoder()

type Source = { pulledBytes: number; cancelled: boolean }

/**
 * A response whose body hands out the chunks one read at a time. After the
 * last chunk it ends, stalls forever, or repeats the last chunk forever.
 */
function responseFrom(
	chunks: Array<string | Uint8Array>,
	{
		after = 'end',
		headers,
	}: { after?: 'end' | 'stall' | 'repeat'; headers?: HeadersInit } = {},
) {
	const source: Source = { pulledBytes: 0, cancelled: false }
	const queue = chunks.map((chunk) =>
		typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
	)
	let index = 0
	const stream = new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				const next =
					index < queue.length
						? queue[index++]
						: after === 'repeat'
							? queue.at(-1)
							: undefined
				if (next) {
					source.pulledBytes += next.byteLength
					controller.enqueue(next)
				} else if (after === 'end') {
					controller.close()
				} else {
					return new Promise(() => {})
				}
			},
			cancel() {
				source.cancelled = true
			},
		},
		{ highWaterMark: 0 },
	)
	return { response: new Response(stream, { headers }), source }
}

const live = () => new AbortController().signal

test('a body of exactly the limit is accepted', async () => {
	const half = 'a'.repeat(LIMIT / 2)
	const { response } = responseFrom([half, half])
	expect(
		await readBoundedText(response, { maxBytes: LIMIT, signal: live() }),
	).toBe(half + half)
})

test('a body one byte over the limit is refused', async () => {
	const { response } = responseFrom([
		'a'.repeat(LIMIT / 2),
		'a'.repeat(LIMIT / 2 + 1),
	])
	await expect(
		readBoundedText(response, { maxBytes: LIMIT, signal: live() }),
	).rejects.toBeInstanceOf(BodyTooLargeError)
})

test('a body larger than its Content-Length claims is refused', async () => {
	const { response } = responseFrom(['a'.repeat(LIMIT + 1)], {
		headers: { 'Content-Length': '10' },
	})
	await expect(
		readBoundedText(response, { maxBytes: LIMIT, signal: live() }),
	).rejects.toBeInstanceOf(BodyTooLargeError)
})

test('the limit counts bytes, not characters', async () => {
	// 513 characters, 1026 bytes.
	const { response } = responseFrom(['é'.repeat(LIMIT / 2 + 1)])
	await expect(
		readBoundedText(response, { maxBytes: LIMIT, signal: live() }),
	).rejects.toBeInstanceOf(BodyTooLargeError)
})

test('an endless body stops being read at the limit and is cancelled', async () => {
	const chunk = new Uint8Array(100).fill(97)
	const { response, source } = responseFrom([chunk], { after: 'repeat' })
	await expect(
		readBoundedText(response, { maxBytes: LIMIT, signal: live() }),
	).rejects.toBeInstanceOf(BodyTooLargeError)
	expect(source.pulledBytes).toBeLessThanOrEqual(LIMIT + chunk.byteLength)
	expect(source.cancelled).toBe(true)
})

test('a character split across chunks decodes intact', async () => {
	const bytes = encoder.encode('café')
	const { response } = responseFrom([bytes.slice(0, 4), bytes.slice(4)])
	expect(
		await readBoundedText(response, { maxBytes: LIMIT, signal: live() }),
	).toBe('café')
})

test('a body that stalls rejects with an AbortError when the signal aborts, and is cancelled', async () => {
	const { response, source } = responseFrom(['<html>partial'], {
		after: 'stall',
	})
	const controller = new AbortController()
	const reading = readBoundedText(response, {
		maxBytes: LIMIT,
		signal: controller.signal,
	})
	await new Promise((resolve) => setTimeout(resolve, 0))
	controller.abort()
	await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
	expect(source.cancelled).toBe(true)
})

test('a signal that aborted before reading rejects with an AbortError at once, leaving the unread body alone', async () => {
	const { response, source } = responseFrom([], { after: 'stall' })
	const controller = new AbortController()
	controller.abort()
	await expect(
		readBoundedText(response, { maxBytes: LIMIT, signal: controller.signal }),
	).rejects.toMatchObject({ name: 'AbortError' })
	// Bun buffers a cancelled body that was never read into memory.
	expect(source.cancelled).toBe(false)
})

test('a response without a body reads as empty text', async () => {
	expect(
		await readBoundedText(new Response(null), {
			maxBytes: LIMIT,
			signal: live(),
		}),
	).toBe('')
})

// Under Bun the import fetches bodies still encoded and the reader decodes
// them. Node's fetch always decodes, but a constructed Response never does, so
// these tests hand the reader encoded bytes directly.

const compressors: Record<string, (text: string) => Uint8Array> = {
	gzip: (text) => gzipSync(text),
	br: (text) => brotliCompressSync(text),
}

test('every encoding the reader asks for decodes to its text', async () => {
	const encodings = ACCEPT_ENCODING.split(', ')
	const decoded: Array<string> = []
	for (const encoding of encodings) {
		const compress = compressors[encoding]
		if (!compress) throw new Error(`No test compressor for ${encoding}`)
		const { response } = responseFrom([compress('<html>café</html>')], {
			headers: { 'Content-Encoding': encoding },
		})
		decoded.push(
			await readBoundedText(response, {
				maxBytes: LIMIT,
				signal: live(),
				encoded: true,
			}),
		)
	}
	expect(decoded).toEqual(encodings.map(() => '<html>café</html>'))
})

test('an encoded body is limited by its decoded size', async () => {
	const compressed = gzipSync('a'.repeat(LIMIT + 1))
	expect(compressed.byteLength).toBeLessThan(LIMIT)
	const { response } = responseFrom([compressed], {
		headers: { 'Content-Encoding': 'gzip' },
	})
	await expect(
		readBoundedText(response, {
			maxBytes: LIMIT,
			signal: live(),
			encoded: true,
		}),
	).rejects.toBeInstanceOf(BodyTooLargeError)
})

test('an endless compression bomb is refused without taking in more than the limit', async () => {
	// Gzip members may follow one another, so repeating one member of zeros
	// makes a body that never ends and decodes hundreds of times larger.
	// Decompression takes in its input without backpressure, so the encoded
	// bytes need a limit of their own.
	const member = gzipSync(new Uint8Array(64 * 1024))
	const { response, source } = responseFrom([member], {
		after: 'repeat',
		headers: { 'Content-Encoding': 'gzip' },
	})
	await expect(
		readBoundedText(response, {
			maxBytes: LIMIT,
			signal: live(),
			encoded: true,
		}),
	).rejects.toBeInstanceOf(BodyTooLargeError)
	expect(source.pulledBytes).toBeLessThanOrEqual(LIMIT + member.byteLength)
	await vi.waitFor(() => expect(source.cancelled).toBe(true))
})

test('a body without a Content-Encoding reads as it is when the reader decodes', async () => {
	const { response } = responseFrom(['<html>café</html>'])
	expect(
		await readBoundedText(response, {
			maxBytes: LIMIT,
			signal: live(),
			encoded: true,
		}),
	).toBe('<html>café</html>')
})

test('a body in an encoding the reader cannot decode is refused without touching it', async () => {
	const { response, source } = responseFrom(['(zstd frames)'], {
		headers: { 'Content-Encoding': 'zstd' },
	})
	await expect(
		readBoundedText(response, {
			maxBytes: LIMIT,
			signal: live(),
			encoded: true,
		}),
	).rejects.toBeInstanceOf(UnsupportedEncodingError)
	expect(source.pulledBytes).toBe(0)
	// Bun buffers a cancelled body that was never read into memory. The
	// caller releases the connection by aborting its fetch instead.
	expect(source.cancelled).toBe(false)
})
