import { HttpResponse, delay, http } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'
import { server } from '#tests/mocks/index.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { sendEmail } from './email.server.ts'
import { init } from './env.server.ts'

const RESEND_URL = 'https://api.resend.com/emails'

const message = {
	to: 'kody@example.com',
	subject: 'Verify your email',
	html: '<p>otp</p>',
	text: 'otp',
}

afterEach(() => {
	vi.unstubAllEnvs()
})

test('production boot fails when the email key is missing', () => {
	consoleError.mockImplementation(() => {})
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('RESEND_API_KEY', '')
	vi.stubEnv('MOCKS', '')

	expect(() => init()).toThrow(/invalid environment variables/i)
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining('Invalid environment variables'),
		expect.objectContaining({
			RESEND_API_KEY: expect.arrayContaining([
				expect.stringMatching(/required in production/i),
			]),
		}),
	)
})

test('MOCKS=false does not bypass the production email-key requirement', () => {
	// Truthiness would treat the string 'false' as mocks-on; only the exact
	// value 'true' may excuse a missing key, matching index.ts's gate.
	consoleError.mockImplementation(() => {})
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('RESEND_API_KEY', '')
	vi.stubEnv('MOCKS', 'false')

	expect(() => init()).toThrow(/invalid environment variables/i)
})

test('production boot succeeds when the email key is present', () => {
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('RESEND_API_KEY', 're_test_key')
	vi.stubEnv('MOCKS', '')

	expect(() => init()).not.toThrow()
})

test('a missing email key outside production still boots', () => {
	vi.stubEnv('NODE_ENV', 'development')
	vi.stubEnv('RESEND_API_KEY', '')
	vi.stubEnv('MOCKS', '')

	expect(() => init()).not.toThrow()
})

test('mock mode boots in production without the key', () => {
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('RESEND_API_KEY', '')
	vi.stubEnv('MOCKS', 'true')

	expect(() => init()).not.toThrow()
})

test('an empty RESEND_TIMEOUT_MS is treated as unset', () => {
	// '' is the .env convention for unused optional vars — it must not become
	// Number('') === 0, i.e. a timeout that aborts every send instantly.
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('RESEND_API_KEY', 're_test_key')
	vi.stubEnv('RESEND_TIMEOUT_MS', '')

	expect(() => init()).not.toThrow()
})

test('a non-numeric RESEND_TIMEOUT_MS fails the boot', () => {
	consoleError.mockImplementation(() => {})
	vi.stubEnv('NODE_ENV', 'development')
	vi.stubEnv('RESEND_TIMEOUT_MS', '10s')

	expect(() => init()).toThrow(/invalid environment variables/i)
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining('Invalid environment variables'),
		expect.objectContaining({
			RESEND_TIMEOUT_MS: expect.arrayContaining([
				expect.stringMatching(/whole number of milliseconds/i),
			]),
		}),
	)
})

test('sendEmail falls back to the default timeout on a bad value', async () => {
	// init() rejects these at boot, but sendEmail must never turn a value that
	// slipped through (tests, scripts) into AbortSignal.timeout(0).
	vi.stubEnv('RESEND_TIMEOUT_MS', '0')

	const result = await sendEmail(message)

	expect(result.status).toBe('success')
})

test('a hung provider request times out as an error result', async () => {
	consoleError.mockImplementation(() => {})
	vi.stubEnv('RESEND_TIMEOUT_MS', '50')
	server.use(
		http.post(RESEND_URL, async () => {
			await delay(5000)
			return HttpResponse.json({ id: 'never-arrives' })
		}),
	)

	const result = await sendEmail(message)

	expect(result.status).toBe('error')
	// Narrowing for the error branch — success has no `error`.
	if (result.status !== 'error') throw new Error('expected an error result')
	expect(result.error.name).toBe('EmailTimeoutError')
	expect(result.error.statusCode).toBe(504)
	// User-facing copy: no configured-timeout value, no transport internals.
	expect(result.error.message).toMatch(/timed out/i)
	expect(result.error.message).not.toMatch(/\d+\s*ms/i)
	// The failure must still reach the logs — callers render the result
	// instead of throwing, so this is the only trace of a provider outage.
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining('Email send failed'),
		expect.objectContaining({ name: 'EmailTimeoutError' }),
	)
})

test('a network failure is an error result, not a thrown exception', async () => {
	consoleError.mockImplementation(() => {})
	server.use(http.post(RESEND_URL, () => HttpResponse.error()))

	const result = await sendEmail(message)

	expect(result.status).toBe('error')
	if (result.status !== 'error') throw new Error('expected an error result')
	expect(result.error.name).toBe('EmailDeliveryError')
	expect(result.error.statusCode).toBe(502)
	// The raw undici text ('fetch failed') is diagnostic, not user-facing.
	expect(result.error.message).not.toMatch(/fetch failed/i)
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining('Email send failed'),
		expect.objectContaining({ name: 'EmailDeliveryError' }),
	)
})

test('a 2xx with an unreadable body still reports success', async () => {
	// Resend accepted the message; claiming failure would invite a retry that
	// rotates the verification code carried by the email that arrived.
	consoleError.mockImplementation(() => {})
	server.use(
		http.post(
			RESEND_URL,
			() => new HttpResponse('<html>gateway page</html>', { status: 200 }),
		),
	)

	const result = await sendEmail(message)

	expect(result.status).toBe('success')
})

test('a non-2xx with an unreadable body keeps the real HTTP status', async () => {
	consoleError.mockImplementation(() => {})
	server.use(
		http.post(
			RESEND_URL,
			() => new HttpResponse('<html>rate limited</html>', { status: 429 }),
		),
	)

	const result = await sendEmail(message)

	expect(result.status).toBe('error')
	if (result.status !== 'error') throw new Error('expected an error result')
	expect(result.error.name).toBe('EmailDeliveryError')
	// A rate limit must stay distinguishable from a DNS failure.
	expect(result.error.statusCode).toBe(429)
})

test('a successful send reports success', async () => {
	const result = await sendEmail(message)

	expect(result.status).toBe('success')
})
