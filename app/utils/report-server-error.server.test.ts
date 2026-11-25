// A demo user's server errors are marked is_demo in PostHog, so demo traffic
// can be told apart from real errors. An is_demo on anyone else, even false,
// would change existing filters.
import { expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { backgroundWorkSettled } from '#app/utils/background.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { reportServerError } from './report-server-error.server.ts'
import '#tests/setup/db-setup.ts'

const { captureServerEvent } = vi.hoisted(() => ({
	captureServerEvent: vi.fn(),
}))
vi.mock('./posthog.server.ts', () => ({ captureServerEvent }))

async function signedIn({ demo }: { demo: boolean }) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...createUser(),
					demoExpiresAt: demo ? new Date(Date.now() + 3_600_000) : null,
				},
			},
		},
		select: { id: true },
	})
	return getSessionCookieHeader(session)
}

/** Reports one error for a request with this cookie; what PostHog got. */
async function reported(cookie?: string) {
	captureServerEvent.mockClear()
	consoleError.mockImplementation(() => {})
	const headers = new Headers()
	if (cookie) headers.set('cookie', cookie)
	reportServerError(
		new Error('Loader failed'),
		new Request(`${BASE_URL}/recipes`, { headers }),
	)
	await backgroundWorkSettled()
	expect(captureServerEvent).toHaveBeenCalledTimes(1)
	const [, event, properties] = captureServerEvent.mock.calls[0]!
	expect(event).toBe('server_error')
	return properties as Record<string, unknown>
}

test("a demo user's server error is marked is_demo", async () => {
	expect(await reported(await signedIn({ demo: true }))).toMatchObject({
		is_demo: true,
	})
})

test("a real user's and a signed-out request's errors have no is_demo", async () => {
	expect(await reported(await signedIn({ demo: false }))).not.toHaveProperty(
		'is_demo',
	)
	expect(await reported()).not.toHaveProperty('is_demo')
})

// The database may be why the request failed in the first place.
test('an error is still reported when the demo lookup fails', async () => {
	const cookie = await signedIn({ demo: true })
	using _lookup = vi
		.spyOn(prisma.session, 'findUnique')
		.mockRejectedValueOnce(new Error('database is locked'))

	const properties = await reported(cookie)

	expect(properties).toMatchObject({ url: `${BASE_URL}/recipes` })
	expect(properties).not.toHaveProperty('is_demo')
})
