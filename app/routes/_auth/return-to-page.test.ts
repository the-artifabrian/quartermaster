import { RouterContextProvider } from 'react-router'
import { safeRedirect } from 'remix-utils/safe-redirect'
import { expect, test, vi } from 'vitest'
import { loader as meLoader } from '#app/routes/me.tsx'
import { loader as changeEmailLoader } from '#app/routes/settings/profile/change-email.tsx'
import { twoFAVerificationType } from '#app/routes/settings/profile/two-factor/_layout.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { requireRecentVerification } from './verify.server.ts'
import '#tests/setup/db-setup.ts'

// Wherever a page sends someone off to sign in or reverify, the address it
// brings them back to must be the page itself: a same-origin path that
// safeRedirect lets through, never React Router's data URL for that page.

async function signedInRequest(path: string, { twoFA = false } = {}) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
	})
	if (twoFA) {
		const { otp: _otp, ...config } = await generateTOTP()
		await prisma.verification.create({
			data: { ...config, type: twoFAVerificationType, target: session.userId },
		})
	}
	return new Request(new URL(path, BASE_URL), {
		headers: { cookie: await getSessionCookieHeader(session) },
	})
}

async function thrownResponse(promise: Promise<unknown>) {
	const thrown = await promise.then(
		() => null,
		(error: unknown) => error,
	)
	expect(thrown).toBeInstanceOf(Response)
	return thrown as Response
}

function redirectToOf(response: Response) {
	const location = new URL(response.headers.get('location')!, BASE_URL)
	return location.searchParams.get('redirectTo')
}

function loaderArgs(request: Request, pattern: string) {
	return {
		request,
		url: new URL(request.url),
		params: {},
		pattern,
		context: new RouterContextProvider(),
	}
}

test('reverifying from a client navigation comes back to the page, not its data', async () => {
	const request = await signedInRequest(
		'/settings/profile/change-email.data?_routes=routes%2Fsettings%2Fprofile%2Fchange-email',
		{ twoFA: true },
	)
	const response = await thrownResponse(requireRecentVerification(request))
	expect(new URL(response.headers.get('location')!).pathname).toBe('/verify')
	expect(redirectToOf(response)).toBe('/settings/profile/change-email')
})

test('reverifying from a page load keeps the page and its own search', async () => {
	const request = await signedInRequest(
		'/settings/profile/two-factor/disable?from=settings',
		{ twoFA: true },
	)
	const response = await thrownResponse(requireRecentVerification(request))
	expect(redirectToOf(response)).toBe(
		'/settings/profile/two-factor/disable?from=settings',
	)
})

test('Change Email sends a vanished user to sign in with a path safeRedirect accepts', async () => {
	const request = await signedInRequest('/settings/profile/change-email.data')
	// The user row goes between the session check and the page's own lookup.
	vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null)
	const response = await thrownResponse(
		changeEmailLoader(loaderArgs(request, '/settings/profile/change-email')),
	)
	const redirectTo = redirectToOf(response)
	expect(redirectTo).toBe('/settings/profile/change-email')
	expect(safeRedirect(redirectTo, '/recipes')).toBe(redirectTo)
})

test('/me sends a vanished user to sign in, back to /me rather than its data', async () => {
	const request = await signedInRequest('/me.data')
	vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null)
	const response = await thrownResponse(meLoader(loaderArgs(request, '/me')))
	expect(redirectToOf(response)).toBe('/me')
})
