import { type AddressInfo } from 'node:net'
import { writeReadableStreamToWritable } from '@react-router/node'
import express from 'express'
import { afterEach, expect, test } from 'vitest'
import { compressionMiddleware } from './compression.ts'

// Regression harness for the SSE-buffering bug: express + the repo's real
// compression middleware, serving a web `Response` through the same
// `writeReadableStreamToWritable` path `@react-router/express` uses. Without
// the event-stream filter, gzip buffers every event until the stream closes.

type Server = ReturnType<express.Express['listen']>

const servers: Array<Server> = []

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.closeAllConnections()
					server.close(() => resolve())
				}),
		),
	)
})

/** Mirrors the express adapter: headers, flushHeaders, stream the body. */
function serveResponse(res: express.Response, response: Response) {
	res.statusCode = response.status
	response.headers.forEach((value, key) => res.append(key, value))
	res.flushHeaders()
	if (response.body) {
		// Rejects when the test disconnects mid-stream; that's the scenario, not
		// a failure.
		return writeReadableStreamToWritable(response.body, res).catch(() => {})
	}
	res.end()
}

async function startApp(configure: (app: express.Express) => void) {
	const app = express()
	app.use(compressionMiddleware())
	configure(app)
	const server = await new Promise<Server>((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s))
	})
	servers.push(server)
	const { port } = server.address() as AddressInfo
	return `http://127.0.0.1:${port}`
}

/** An SSE response shaped like `resources/household-events`. */
function eventStreamResponse(emit: (send: (event: string) => void) => void) {
	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		start(controller) {
			emit((event) => {
				try {
					controller.enqueue(encoder.encode(event))
				} catch {
					// stream already closed
				}
			})
		},
	})
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	})
}

test('an event emitted on an open stream reaches the client within ~1s', async () => {
	// Padded past compression's 1KB threshold so a compressed stream would
	// genuinely buffer rather than pass through for being too small.
	const padding = 'x'.repeat(2048)
	let send: ((event: string) => void) | undefined
	let close: (() => void) | undefined

	const baseUrl = await startApp((app) => {
		app.get('/events', (_req, res) => {
			void serveResponse(
				res,
				eventStreamResponse((emit) => {
					send = emit
					close = () => res.end()
					emit(`event: connected\ndata: {"pad":"${padding}"}\n\n`)
				}),
			)
		})
	})

	const controller = new AbortController()
	const res = await fetch(`${baseUrl}/events`, { signal: controller.signal })
	expect(res.headers.get('Content-Type')).toContain('text/event-stream')
	expect(res.headers.get('Content-Encoding')).toBeNull()

	const reader = res.body!.getReader()
	const decoder = new TextDecoder()

	// Drain the `connected` frame so the next read waits on a live event.
	await reader.read()

	const emittedAt = Date.now()
	send!('event: activity\ndata: {"id":"evt-1"}\n\n')

	let received = ''
	while (!received.includes('evt-1')) {
		const { value, done } = await reader.read()
		if (done) break
		received += decoder.decode(value, { stream: true })
	}
	const latency = Date.now() - emittedAt

	expect(received).toContain('evt-1')
	// The stream is still open — arrival must not depend on it closing.
	expect(latency).toBeLessThan(1000)

	close?.()
	controller.abort()
})

test('ordinary responses are still compressed', async () => {
	const html = `<!doctype html><html><body>${'quartermaster '.repeat(200)}</body></html>`
	const baseUrl = await startApp((app) => {
		app.get('/page', (_req, res) => {
			res.setHeader('Content-Type', 'text/html; charset=utf-8')
			res.end(html)
		})
		app.get('/data', (_req, res) => {
			void serveResponse(
				res,
				new Response(JSON.stringify({ items: Array(200).fill('item') }), {
					headers: { 'Content-Type': 'application/json' },
				}),
			)
		})
	})

	const encodings: Record<string, string | null> = {}
	const lengths: Record<string, number> = {}
	for (const path of ['/page', '/data']) {
		const res = await fetch(`${baseUrl}${path}`, {
			headers: { 'Accept-Encoding': 'gzip' },
		})
		encodings[path] = res.headers.get('Content-Encoding')
		lengths[path] = (await res.text()).length
	}
	expect(encodings).toEqual({ '/page': 'gzip', '/data': 'gzip' })
	expect(lengths['/page']).toBeGreaterThan(0)
	expect(lengths['/data']).toBeGreaterThan(0)
})
