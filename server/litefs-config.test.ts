import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const config = readFileSync(
	new URL('../other/litefs.yml', import.meta.url),
	'utf8',
)

function getTopLevelSection(name: string) {
	const marker = `${name}:\n`
	const start = config.indexOf(marker)
	if (start < 0) throw new Error(`Missing ${name} section in other/litefs.yml`)

	const remainder = config.slice(start + marker.length)
	const end = remainder.search(/^\S/m)
	return end < 0 ? remainder : remainder.slice(0, end)
}

describe('LiteFS deployment config', () => {
	test('makes the sole node a writable static primary without Consul', () => {
		const lease = getTopLevelSection('lease')

		expect(lease).toMatch(/^  type: ['"]static['"]$/m)
		expect(lease).toMatch(/^  candidate: true$/m)
		expect(lease).toMatch(/^  advertise-url: ['"].+:20202['"]$/m)
		expect(lease).not.toMatch(/^  consul:/m)
		expect(config).not.toContain('FLY_CONSUL_URL')
	})

	test('keeps the proxy in front of the application', () => {
		const proxy = getTopLevelSection('proxy')

		expect(proxy).toContain("addr: ':${INTERNAL_PORT}'")
		expect(proxy).toContain("target: 'localhost:${PORT}'")
		expect(proxy).toContain("db: '${DATABASE_FILENAME}'")
	})
})
