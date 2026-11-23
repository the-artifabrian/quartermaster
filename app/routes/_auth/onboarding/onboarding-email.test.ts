import { RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { BASE_URL, convertSetCookieToCookie } from '#tests/utils.ts'
import { loader } from './index.tsx'
import { setOnboardingEmail } from './onboarding-email.server.ts'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

// Failure list for the verified email the signup form reads from the verify
// cookie after an emailed code:
// 1. Within 10 minutes the form opens with that address.
// 2. A kept copy of the cookie older than 10 minutes is refused.
// 3. A cookie from before the expiry was added, holding only the address, is
//    refused.

afterEach(() => {
	vi.useRealTimers()
})

async function cookieWith(values: Record<string, unknown>) {
	const session = await verifySessionStorage.getSession()
	for (const [key, value] of Object.entries(values)) session.set(key, value)
	return convertSetCookieToCookie(
		await verifySessionStorage.commitSession(session),
	)
}

async function verifiedCookie(email: string) {
	const session = await verifySessionStorage.getSession()
	setOnboardingEmail(session, email)
	return convertSetCookieToCookie(
		await verifySessionStorage.commitSession(session),
	)
}

function openSignup(cookie: string) {
	const url = `${BASE_URL}/onboarding`
	return loader({
		request: new Request(url, { headers: { cookie } }),
		url: new URL(url),
		params: {},
		pattern: '/onboarding',
		context: new RouterContextProvider(),
	}).catch((thrown: unknown) => thrown)
}

function location(result: unknown) {
	return result instanceof Response ? result.headers.get('location') : null
}

test('the signup form opens with the verified address for 10 minutes', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	const cookie = await verifiedCookie('fresh@example.com')

	vi.setSystemTime(Date.now() + 9 * 60 * 1000)
	expect(await openSignup(cookie)).toMatchObject({
		email: 'fresh@example.com',
	})

	vi.setSystemTime(Date.now() + 2 * 60 * 1000)
	expect(location(await openSignup(cookie))).toBe('/signup')
})

test('a cookie holding only the address is refused', async () => {
	const cookie = await cookieWith({ onboardingEmail: 'old@example.com' })

	expect(location(await openSignup(cookie))).toBe('/signup')
})
