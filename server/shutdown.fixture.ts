import { createServer } from 'node:http'
import { runInBackground } from '../app/utils/background.server.ts'
import { registerEventStream } from '../app/utils/event-streams.server.ts'
import { registerGracefulShutdown } from './shutdown.ts'

const server = createServer((request, response) => {
	// Background work, as a reset email is: one that ends soon, and one that
	// never does.
	if (request.url === '/slow-work' || request.url === '/stuck-work') {
		runInBackground(
			request.url === '/slow-work'
				? new Promise((resolve) => setTimeout(resolve, 800)).then(() =>
						console.log('BACKGROUND_DONE'),
					)
				: new Promise(() => {}),
			request.url,
		)
		response.writeHead(200).end('started')
		console.log('WORK_STARTED')
		return
	}
	if (request.url !== '/events') {
		response.writeHead(404).end()
		return
	}

	response.writeHead(200, {
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
		'Content-Type': 'text/event-stream',
	})
	response.write(': connected\n\n')
	const unregister = registerEventStream(() => response.end())
	response.once('close', unregister)
	console.log('SSE_CONNECTED')
})

registerGracefulShutdown(server, {
	flushTelemetry: async () => console.log('TELEMETRY_FLUSHED'),
})

server.listen(0, '127.0.0.1', () => {
	const address = server.address()
	if (!address || typeof address === 'string') {
		throw new Error('Expected a TCP server address')
	}
	console.log(`LISTENING:${address.port}`)
})
