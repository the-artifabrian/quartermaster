import { createServer } from 'node:http'
import { registerEventStream } from '../app/utils/event-streams.server.ts'
import { registerGracefulShutdown } from './shutdown.ts'

const server = createServer((request, response) => {
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
