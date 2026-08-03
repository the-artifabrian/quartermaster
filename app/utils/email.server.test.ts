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

	expect(() => init()).toThrow(/RESEND_API_KEY/i)
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining('RESEND_API_KEY is required in production'),
	)
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

test('a hung provider request times out as an error result', async () => {
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
	expect(result.error.message).toMatch(/timed out after 50ms/)
})

test('a network failure is an error result, not a thrown exception', async () => {
	server.use(http.post(RESEND_URL, () => HttpResponse.error()))

	const result = await sendEmail(message)

	expect(result.status).toBe('error')
	if (result.status !== 'error') throw new Error('expected an error result')
	expect(result.error.name).toBe('EmailDeliveryError')
	expect(result.error.statusCode).toBe(502)
})

test('a successful send reports success', async () => {
	const result = await sendEmail(message)

	expect(result.status).toBe('success')
})
