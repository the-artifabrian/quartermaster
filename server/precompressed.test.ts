import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { type AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
	brotliCompressSync,
	brotliDecompressSync,
	gunzipSync,
	gzipSync,
} from 'node:zlib'
import express from 'express'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { compressionMiddleware } from './compression.ts'
import { servePrecompressed } from './precompressed.ts'

// The middleware sits in front of express.static behind the repo's real
// compression middleware, the way server/index.ts mounts it.

type Server = ReturnType<express.Express['listen']>
type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

const servers: Array<Server> = []
// Long enough that the compression middleware would compress it itself.
const script = `export const answer = ${JSON.stringify('x'.repeat(2048))}\n`
const style = `body { color: red; }\n`.repeat(100)
let assets: string

beforeAll(async () => {
	assets = await mkdtemp(path.join(os.tmpdir(), 'precompressed-'))
	await writeFile(path.join(assets, 'app-abc123.js'), script)
	await writeFile(
		path.join(assets, 'app-abc123.js.br'),
		brotliCompressSync(script),
	)
	await writeFile(path.join(assets, 'app-abc123.js.gz'), gzipSync(script))
	// A twin-less asset, as a file below the size floor would be.
	await writeFile(path.join(assets, 'lone-def456.css'), style)
})

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

/** fetch decodes Content-Encoding on the way in; this keeps the bytes as sent. */
function request(
	url: string,
	headers: Record<string, string> = {},
	method = 'GET',
): Promise<Raw> {
	return new Promise((resolve, reject) => {
		http
			.request(url, { method, headers }, (res) => {
				const chunks: Array<Buffer> = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks),
					}),
				)
			})
			.on('error', reject)
			.end()
	})
}

async function startApp(directory = assets) {
	const app = express()
	app.use(compressionMiddleware())
	app.use(
		'/assets',
		servePrecompressed(directory),
		express.static(directory, {
			immutable: true,
			maxAge: '1y',
			fallthrough: false,
		}),
	)
	const server = await new Promise<Server>((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s))
	})
	servers.push(server)
	const { port } = server.address() as AddressInfo
	return `http://127.0.0.1:${port}`
}

test('a client that accepts brotli gets the .br twin as the asset itself', async () => {
	const base = await startApp()
	const response = await request(`${base}/assets/app-abc123.js`, {
		'accept-encoding': 'gzip, deflate, br, zstd',
	})
	expect(response.status).toBe(200)
	expect(response.headers['content-encoding']).toBe('br')
	expect(response.headers['content-type']).toBe(
		'text/javascript; charset=utf-8',
	)
	expect(response.headers.vary).toBe('Accept-Encoding')
	expect(response.headers['cache-control']).toContain('immutable')
	expect(response.headers['content-length']).toBe(String(response.body.length))
	// Sent once, not compressed a second time by the compression middleware.
	expect(brotliDecompressSync(response.body).toString()).toBe(script)
})

test('a client that accepts only gzip gets the .gz twin', async () => {
	const base = await startApp()
	const response = await request(`${base}/assets/app-abc123.js?v=1`, {
		'accept-encoding': 'gzip',
	})
	expect(response.headers['content-encoding']).toBe('gzip')
	expect(gunzipSync(response.body).toString()).toBe(script)
})

test('a client that accepts no encoding gets the plain file', async () => {
	const base = await startApp()
	const response = await request(`${base}/assets/app-abc123.js`, {
		'accept-encoding': 'identity',
	})
	expect(response.headers['content-encoding']).toBeUndefined()
	expect(response.body.toString()).toBe(script)
})

test('an asset without a twin is served as before', async () => {
	const base = await startApp()
	const response = await request(`${base}/assets/lone-def456.css`, {
		'accept-encoding': 'gzip, deflate, br',
	})
	expect(response.status).toBe(200)
	expect(response.headers['content-type']).toBe('text/css; charset=utf-8')
	// The compression middleware still compresses it on the fly, as before.
	expect(response.headers['content-encoding']).toBe('br')
	expect(brotliDecompressSync(response.body).toString()).toBe(style)
})

test('HEAD carries the twin headers and no body', async () => {
	const base = await startApp()
	const response = await request(
		`${base}/assets/app-abc123.js`,
		{ 'accept-encoding': 'br' },
		'HEAD',
	)
	expect(response.status).toBe(200)
	expect(response.headers['content-encoding']).toBe('br')
	expect(response.body.length).toBe(0)
})

test('a conditional request still answers 304', async () => {
	const base = await startApp()
	const first = await request(`${base}/assets/app-abc123.js`, {
		'accept-encoding': 'br',
	})
	const etag = first.headers.etag
	expect(etag).toBeTruthy()
	const second = await request(`${base}/assets/app-abc123.js`, {
		'accept-encoding': 'br',
		'if-none-match': etag!,
	})
	expect(second.status).toBe(304)
})

test('a name outside the listing is left to the static handler', async () => {
	const base = await startApp()
	const response = await request(`${base}/assets/missing-000000.js`, {
		'accept-encoding': 'br',
	})
	expect(response.status).toBe(404)
})

test('a missing assets directory does not stop the server from starting', async () => {
	const base = await startApp(path.join(assets, 'not-built'))
	const response = await request(`${base}/assets/app-abc123.js`, {
		'accept-encoding': 'br',
	})
	expect(response.status).toBe(404)
})
