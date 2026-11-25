import { once } from 'node:events'
import { type AddressInfo } from 'node:net'
import express from 'express'
import { expect, test } from 'vitest'
import { requestLog } from './request-log.ts'

// The request log ends up in Fly's log store. The path and the parameters that
// aren't secret stay readable.

async function logLineFor(path: string) {
	const lines: string[] = []
	const app = express()
	app.use(requestLog({ stream: { write: (line) => void lines.push(line) } }))
	app.use((_req, res) => {
		res.status(204).end()
	})
	const server = app.listen(0, '127.0.0.1')
	await once(server, 'listening')
	try {
		const { port } = server.address() as AddressInfo
		const response = await fetch(`http://127.0.0.1:${port}${path}`)
		await response.arrayBuffer()
		// morgan writes when the response finishes, which can be just after
		// the client has it.
		await expect.poll(() => lines.length).toBe(1)
		return lines[0]!
	} finally {
		server.close()
	}
}

test('codes, tokens and email addresses are left out of the request log', async () => {
	const line = await logLineFor(
		'/verify?type=onboarding&target=ada%40example.com&code=Q2W3E4&redirectTo=%2Fhousehold%2Fjoin%3Ftoken%3Dinvite-abc',
	)
	expect(line).toContain('/verify?type=onboarding')
	expect(line).not.toMatch(/Q2W3E4|invite-abc|ada@example\.com|ada%40/)
})

test('a URL that cannot be decoded still logs without its code', async () => {
	const line = await logLineFor('/verify?code=Q2W3E4&x=%E0%A4%A')
	expect(line).toContain('/verify?')
	expect(line).not.toContain('Q2W3E4')
})
