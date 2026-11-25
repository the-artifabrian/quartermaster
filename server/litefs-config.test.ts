import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (file: string) =>
	readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

function match(text: string, pattern: RegExp, what: string) {
	const found = pattern.exec(text)?.[1]
	if (found === undefined) throw new Error(`Missing ${what}`)
	return found
}

// Fly sends traffic to internal_port, the LiteFS proxy listens on
// INTERNAL_PORT and forwards to PORT, where the app listens. If any of these
// drift apart, every request fails while the machine looks healthy to Fly.
test('Fly, the LiteFS proxy and the app agree on their ports', () => {
	const flyToml = read('fly.toml')
	const dockerfile = read('other/Dockerfile')
	const litefs = read('other/litefs.yml')

	const flyPort = match(
		flyToml,
		/^internal_port = ([\d_]+)$/m,
		'internal_port in fly.toml',
	).replaceAll('_', '')
	const internalPort = match(
		dockerfile,
		/^ENV INTERNAL_PORT="?(\d+)"?$/m,
		'INTERNAL_PORT in the Dockerfile',
	)
	const appPort = match(dockerfile, /^ENV PORT="?(\d+)"?$/m, 'PORT')

	expect(internalPort).toBe(flyPort)
	expect(appPort).not.toBe(internalPort)
	expect(litefs).toMatch(/^ {2}addr: ':\$\{INTERNAL_PORT\}'$/m)
	expect(litefs).toMatch(/^ {2}target: 'localhost:\$\{PORT\}'$/m)
})
