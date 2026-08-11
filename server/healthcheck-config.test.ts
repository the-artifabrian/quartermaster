import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { SQLITE_BUSY_TIMEOUT_MS } from '../app/utils/db.server.ts'

const MINIMUM_RESPONSE_MARGIN_MS = 1_000

function durationToMilliseconds(duration: string) {
	const match = /^(\d+)(ms|s)$/.exec(duration)
	if (!match) throw new Error(`Unsupported duration: ${duration}`)
	const value = Number(match[1])
	return match[2] === 's' ? value * 1000 : value
}

describe('healthcheck deployment config', () => {
	test('allows the database write probe to exhaust its busy timeout and respond', () => {
		const healthcheck = readFileSync('fly.toml', 'utf8')
			.split('[[services.http_checks]]')
			.slice(1)
			.map((block) => block.split('[[', 1)[0] ?? '')
			.find((block) => block.includes('path = "/resources/healthcheck"'))
		const timeout = /^\s*timeout = "([^"]+)"/m.exec(healthcheck ?? '')?.[1]

		expect(healthcheck).toBeDefined()
		expect(timeout).toBeDefined()
		expect(durationToMilliseconds(timeout!)).toBeGreaterThanOrEqual(
			SQLITE_BUSY_TIMEOUT_MS + MINIMUM_RESPONSE_MARGIN_MS,
		)
	})
})
