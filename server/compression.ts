import compression from 'compression'

/**
 * `text/event-stream` is not in mime-db, so compression's `/^text\//`
 * compressible fallback matches it and gzip engages on the SSE route. Nothing
 * on the react-router express path ever calls compression's `res.flush()` —
 * the adapter only calls `res.flushHeaders()` — so every household event sits
 * in the zlib buffer until the stream closes at its 5-minute lifetime cap.
 * Live sync stops being live.
 *
 * Content-Type is set by the time the first `res.write()` runs, which is when
 * compression evaluates this filter.
 *
 * Note the never-flushed premise isn't SSE-specific: streaming SSR
 * (`entry.server.tsx` only awaits `allReady` for bots) goes through the same
 * unflushed gzip stream, so chunks wait for zlib's 16KB buffer or the end of
 * the response. That costs progressive rendering, not correctness — unlike
 * SSE, the response does end promptly — so it's left alone here.
 */
export function isCompressible(
	req: Parameters<typeof compression.filter>[0],
	res: Parameters<typeof compression.filter>[1],
) {
	const contentType = String(res.getHeader('Content-Type') ?? '')
	if (contentType.includes('text/event-stream')) return false
	return compression.filter(req, res)
}

export const compressionMiddleware = () =>
	compression({ filter: isCompressible })
