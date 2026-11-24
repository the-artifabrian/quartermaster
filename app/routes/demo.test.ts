/**
 * The demo route, which starts and ends a visitor's demo, and Log Out for a
 * demo user.
 *
 * Failure list:
 * Start
 * - A signed-in real user who posts gets a demo copy, or loses their own
 *   session, instead of going to their Recipes.
 * - A signed-in demo user gets a second copy, which holds a second live slot.
 * - A browser still holding the cookie of a demo that ran out is sent to the
 *   homepage with the cookie cleared, so the visitor has to tap twice.
 * - When the demo is full or has no template yet, a user or a session is
 *   made anyway, no message says why, or the redirect follows a `redirectTo`
 *   to another site.
 * - The demo session lasts the usual 30 days, so the visitor stays signed
 *   in after the demo ended, until the hourly sweep deletes the user.
 * - The cookie is remembered (it has an Expires) in a browser, or in the iOS
 *   app, where sign-ins are normally always remembered, or it keeps the
 *   Expires of an earlier remembered cookie on the same browser.
 * - A 2FA sign-in left pending on the browser carries over into the demo.
 * - The sample week is the server's week, not the visitor's, near midnight
 *   on a Sunday.
 * End (`intent=end`)
 * - A demo user's account stays, so it keeps a live slot, or their cookies
 *   stay, so /signup bounces them.
 * - A real user's account is deleted, or they are signed out.
 * - An absolute or `//` `redirectTo` sends the browser to another site.
 * - A browser holding a dead session's cookie keeps it, so /signup, which
 *   ends dead sessions by sending them home, bounces the visitor to `/`.
 * Other
 * - A GET starts or ends anything.
 * - Log Out leaves a demo user's account until the sweep, or deletes a real
 *   user's account, or a delete that fails keeps the session alive.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import * as setCookieParser from 'set-cookie-parser'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { getUserId, sessionKey } from '#app/utils/auth.server.ts'
import type * as AccountDeletion from '#app/utils/account-deletion.server.ts'
import { deleteAccount } from '#app/utils/account-deletion.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { DEMO_LIFETIME_MS, DEMO_LIVE_LIMIT } from '#app/utils/demo.ts'
import { ensureDemoTemplate } from '#app/utils/demo.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { getToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { createUser, ensureUserRole } from '#tests/db-utils.ts'
import {
	BASE_URL,
	convertSetCookieToCookie,
	getSessionCookieHeader,
} from '#tests/utils.ts'
import { action as logoutAction } from './_auth/logout.tsx'
import { action, loader } from './demo.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'

vi.mock('#app/utils/account-deletion.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof AccountDeletion>()
	return { ...real, deleteAccount: vi.fn(real.deleteAccount) }
})

const SAFARI_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const SHELL_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QuartermasterShell/1'

let emptyPhotoDir: string

beforeAll(async () => {
	emptyPhotoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-route-'))
})

afterAll(async () => {
	await fs.rm(emptyPhotoDir, { recursive: true, force: true })
})

afterEach(() => {
	vi.useRealTimers()
	vi.mocked(deleteAccount).mockClear()
})

/**
 * A template of the sample Recipes. With no photo files, it stores no
 * photos, which a copy doesn't need here.
 */
function buildTemplate() {
	return ensureDemoTemplate(prisma, {
		photoDir: emptyPhotoDir,
		log: { warn: () => {}, error: () => {} },
	})
}

function request(
	method: 'GET' | 'POST',
	urlPath: string,
	{
		body,
		cookie,
		userAgent = SAFARI_UA,
	}: {
		body?: Record<string, string>
		cookie?: string
		userAgent?: string
	} = {},
) {
	const headers = new Headers({ 'User-Agent': userAgent })
	if (cookie) headers.set('Cookie', cookie)
	return new Request(
		`${BASE_URL}${urlPath}`,
		method === 'POST'
			? { method, headers, body: new URLSearchParams(body ?? {}) }
			: { method, headers },
	)
}

function routeArgs(req: Request, pattern = '/demo') {
	return {
		request: req,
		params: {},
		pattern,
		url: new URL(req.url),
		context: new RouterContextProvider(),
	}
}

/** The action's Response, whether it returned or threw it. */
async function respond(run: () => Promise<unknown>) {
	const result = await run().catch((thrown: unknown) => thrown)
	if (!(result instanceof Response)) {
		throw new Error(`Expected a Response, got ${String(result)}`)
	}
	return result
}

function postDemo(options: Parameters<typeof request>[2] = {}) {
	return respond(() => action(routeArgs(request('POST', '/demo', options))))
}

function setCookies(response: Response) {
	return setCookieParser.parse(response.headers.getSetCookie())
}

function cookieNamed(response: Response, name: string) {
	return setCookies(response).find((c) => c.name === name)
}

/** A Cookie header that sends back every cookie the response set. */
function cookieHeaderFrom(response: Response, existing = '') {
	const jar = new Map(
		existing
			.split('; ')
			.filter(Boolean)
			.map((pair) => pair.split('=') as [string, string]),
	)
	for (const cookie of setCookies(response)) {
		if (cookie.value) jar.set(cookie.name, cookie.value)
		else jar.delete(cookie.name)
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function toastOf(response: Response) {
	const { toast } = await getToast(
		new Request(BASE_URL, {
			headers: { Cookie: cookieHeaderFrom(response) },
		}),
	)
	return toast
}

/** A cookie is ended when it is set to expire in the past. */
function ended(response: Response, name: string) {
	const cookie = cookieNamed(response, name)
	return Boolean(cookie?.expires && cookie.expires.getTime() <= Date.now())
}

async function realUser() {
	await ensureUserRole()
	const user = await prisma.user.create({
		data: { ...createUser(), roles: { connect: { name: 'user' } } },
		select: { id: true },
	})
	const session = await prisma.session.create({
		data: {
			userId: user.id,
			expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
		},
		select: { id: true },
	})
	return { userId: user.id, cookie: await getSessionCookieHeader(session) }
}

function demoUsers() {
	return prisma.user.findMany({
		where: { demoExpiresAt: { not: null } },
		select: { id: true, demoExpiresAt: true },
	})
}

/** Start a demo and return the visitor and the browser's cookies. */
async function startDemo(options: Parameters<typeof request>[2] = {}) {
	const response = await postDemo(options)
	const [visitor] = await demoUsers()
	if (!visitor) throw new Error('No demo user was made')
	return {
		response,
		userId: visitor.id,
		demoExpiresAt: visitor.demoExpiresAt!,
		cookie: cookieHeaderFrom(response, options.cookie),
	}
}

// Start

test('a visitor gets a demo user, a session and lands on their Recipes', async () => {
	await buildTemplate()

	const { response, userId, cookie } = await startDemo()

	expect(response.status).toBe(302)
	expect(response.headers.get('location')).toBe('/recipes')
	await expect(getUserId(request('GET', '/recipes', { cookie }))).resolves.toBe(
		userId,
	)
	const recipes = await prisma.recipe.count({ where: { userId } })
	expect(recipes).toBeGreaterThan(0)
})

test('a signed-in real user is sent to their Recipes and no demo is made', async () => {
	await buildTemplate()
	const { userId, cookie } = await realUser()

	const response = await postDemo({ cookie })

	expect(response.headers.get('location')).toBe('/recipes')
	expect(cookieNamed(response, 'en_session')).toBeUndefined()
	expect(await demoUsers()).toEqual([])
	await expect(getUserId(request('GET', '/recipes', { cookie }))).resolves.toBe(
		userId,
	)
})

test('a signed-in demo user is sent to their Recipes and gets no second copy', async () => {
	await buildTemplate()
	const first = await startDemo()

	const again = await postDemo({ cookie: first.cookie })

	expect(again.headers.get('location')).toBe('/recipes')
	expect(cookieNamed(again, 'en_session')).toBeUndefined()
	expect((await demoUsers()).map((u) => u.id)).toEqual([first.userId])
})

test('a browser holding the cookie of a demo that ran out gets a new demo in one tap', async () => {
	await buildTemplate()
	const first = await startDemo()
	await prisma.session.updateMany({
		where: { userId: first.userId },
		data: { expirationDate: new Date(Date.now() - 1000) },
	})
	await prisma.user.update({
		where: { id: first.userId },
		data: { demoExpiresAt: new Date(Date.now() - 1000) },
	})

	const second = await postDemo({ cookie: first.cookie })

	expect(second.headers.get('location')).toBe('/recipes')
	const visitors = await demoUsers()
	const newVisitor = visitors.find((u) => u.id !== first.userId)
	expect(newVisitor).toBeDefined()
	const cookie = cookieHeaderFrom(second, first.cookie)
	await expect(getUserId(request('GET', '/recipes', { cookie }))).resolves.toBe(
		newVisitor!.id,
	)
})

test('a full demo makes nothing and says so on the page the visitor came from', async () => {
	await buildTemplate()
	await ensureUserRole()
	for (let i = 0; i < DEMO_LIVE_LIMIT; i++) {
		await prisma.user.create({
			data: {
				...createUser(),
				demoExpiresAt: new Date(Date.now() + DEMO_LIFETIME_MS),
			},
		})
	}
	const sessionsBefore = await prisma.session.count()

	const response = await postDemo({ body: { redirectTo: '/login' } })

	expect(response.headers.get('location')).toBe('/login')
	expect(await toastOf(response)).toMatchObject({
		description: 'The demo is full right now. Try again in a few minutes.',
	})
	expect(cookieNamed(response, 'en_session')).toBeUndefined()
	expect(await demoUsers()).toHaveLength(DEMO_LIVE_LIMIT)
	expect(await prisma.session.count()).toBe(sessionsBefore)
})

test('with no template the demo is unavailable, makes nothing and says so', async () => {
	const response = await postDemo()

	expect(response.headers.get('location')).toBe('/')
	expect(await toastOf(response)).toMatchObject({
		description: 'The demo isn’t available right now.',
	})
	expect(cookieNamed(response, 'en_session')).toBeUndefined()
	expect(await demoUsers()).toEqual([])
	expect(await prisma.session.count()).toBe(0)
})

test.each(['https://evil.example/', '//evil.example', '/\\evil.example'])(
	'a refused start ignores a redirectTo of %s',
	async (redirectTo) => {
		const response = await postDemo({ body: { redirectTo } })
		expect(response.headers.get('location')).toBe('/')
	},
)

test('the demo session ends when the demo does, before the sweep runs', async () => {
	await buildTemplate()
	const { userId, cookie, demoExpiresAt } = await startDemo()
	const session = await prisma.session.findFirstOrThrow({
		where: { userId },
		select: { expirationDate: true },
	})
	expect(session.expirationDate).toEqual(demoExpiresAt)

	vi.useFakeTimers({
		toFake: ['Date'],
		now: demoExpiresAt.getTime() - 60_000,
	})
	await expect(getUserId(request('GET', '/recipes', { cookie }))).resolves.toBe(
		userId,
	)

	vi.setSystemTime(demoExpiresAt.getTime() + 1000)
	const signedOut = await respond(() =>
		getUserId(request('GET', '/recipes', { cookie })),
	)
	expect(signedOut.headers.get('location')).toBe('/')
	// The sweep hasn't run: the user is still there.
	expect(await prisma.user.count({ where: { id: userId } })).toBe(1)
})

test.each([
	['a browser', SAFARI_UA],
	['the iOS app', SHELL_UA],
])('in %s the demo cookie is never remembered', async (_, userAgent) => {
	await buildTemplate()

	const { response } = await startDemo({ userAgent })

	const cookie = cookieNamed(response, 'en_session')
	expect(cookie).toBeDefined()
	expect(cookie!.expires).toBeUndefined()
	expect(cookie!.maxAge).toBeUndefined()
})

test('a remembered cookie from before doesn’t make the demo cookie remembered', async () => {
	await buildTemplate()
	// A dead remembered session, as a real user who logged in with Remember
	// me leaves when it runs out.
	const old = await authSessionStorage.getSession()
	old.set(sessionKey, 'gone')
	const oldCookie = await authSessionStorage.commitSession(old, {
		expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
	})

	const { response } = await startDemo({
		cookie: convertSetCookieToCookie(oldCookie),
	})

	expect(cookieNamed(response, 'en_session')!.expires).toBeUndefined()
})

test('a 2FA sign-in left pending on the browser is dropped', async () => {
	await buildTemplate()
	const verifySession = await verifySessionStorage.getSession()
	verifySession.set('unverified-session-id', 'pending')
	const verifyCookie = await verifySessionStorage.commitSession(verifySession)

	const { response } = await startDemo({
		cookie: convertSetCookieToCookie(verifyCookie),
	})

	expect(ended(response, 'en_verification')).toBe(true)
})

test('the sample week is the visitor’s week, from their timezone', async () => {
	await buildTemplate()
	// Sunday evening in UTC is already Monday in Auckland.
	vi.useFakeTimers({
		toFake: ['Date'],
		now: new Date('2026-11-29T20:00:00Z'),
	})

	const { userId } = await startDemo({
		cookie: `CH-time-zone=${encodeURIComponent('Pacific/Auckland')}`,
	})

	const plans = await prisma.mealPlan.findMany({
		where: { household: { members: { some: { userId } } } },
		select: { weekStart: true },
	})
	expect(plans.map((p) => p.weekStart.toISOString())).toContain(
		'2026-11-30T00:00:00.000Z',
	)
	expect(plans.map((p) => p.weekStart.toISOString())).not.toContain(
		'2026-11-23T00:00:00.000Z',
	)
})

// End

test('ending a demo deletes the demo user, ends the cookies and goes where asked', async () => {
	await buildTemplate()
	const { userId, cookie } = await startDemo()

	const response = await respond(() =>
		action(
			routeArgs(
				request('POST', '/demo', {
					cookie,
					body: { intent: 'end', redirectTo: '/signup' },
				}),
			),
		),
	)

	expect(response.headers.get('location')).toBe('/signup')
	expect(ended(response, 'en_session')).toBe(true)
	expect(await prisma.user.count({ where: { id: userId } })).toBe(0)
	expect(await prisma.session.count({ where: { userId } })).toBe(0)
})

test('ending a demo for a real user deletes nothing and keeps them signed in', async () => {
	const { userId, cookie } = await realUser()

	const response = await respond(() =>
		action(
			routeArgs(
				request('POST', '/demo', {
					cookie,
					body: { intent: 'end', redirectTo: '/signup' },
				}),
			),
		),
	)

	expect(response.headers.get('location')).toBe('/signup')
	expect(cookieNamed(response, 'en_session')).toBeUndefined()
	expect(deleteAccount).not.toHaveBeenCalled()
	await expect(getUserId(request('GET', '/recipes', { cookie }))).resolves.toBe(
		userId,
	)
})

test.each(['https://evil.example/', '//evil.example'])(
	'ending a demo ignores a redirectTo of %s',
	async (redirectTo) => {
		await buildTemplate()
		const { userId, cookie } = await startDemo()

		const response = await respond(() =>
			action(
				routeArgs(
					request('POST', '/demo', {
						cookie,
						body: { intent: 'end', redirectTo },
					}),
				),
			),
		)

		expect(response.headers.get('location')).toBe('/')
		expect(await prisma.user.count({ where: { id: userId } })).toBe(0)
	},
)

test('ending a demo that already ran out clears the dead cookie, so Sign up opens', async () => {
	await buildTemplate()
	const { userId, cookie } = await startDemo()
	await prisma.session.deleteMany({ where: { userId } })

	const response = await respond(() =>
		action(
			routeArgs(
				request('POST', '/demo', {
					cookie,
					body: { intent: 'end', redirectTo: '/signup' },
				}),
			),
		),
	)

	expect(response.headers.get('location')).toBe('/signup')
	expect(ended(response, 'en_session')).toBe(true)
})

// Other

test('a GET to /demo goes home and starts nothing', async () => {
	await buildTemplate()

	const response = await respond(async () => loader())

	expect(response.headers.get('location')).toBe('/')
	expect(cookieNamed(response, 'en_session')).toBeUndefined()
	expect(await demoUsers()).toEqual([])
})

test('Log Out deletes a demo user at once, which frees the slot', async () => {
	await buildTemplate()
	const { userId, cookie } = await startDemo()

	const response = await respond(() =>
		logoutAction(routeArgs(request('POST', '/logout', { cookie }), '/logout')),
	)

	expect(response.headers.get('location')).toBe('/')
	expect(ended(response, 'en_session')).toBe(true)
	expect(await prisma.user.count({ where: { id: userId } })).toBe(0)
	expect(await demoUsers()).toEqual([])
})

test('Log Out of a real user deletes nothing', async () => {
	const { userId, cookie } = await realUser()

	const response = await respond(() =>
		logoutAction(routeArgs(request('POST', '/logout', { cookie }), '/logout')),
	)

	expect(ended(response, 'en_session')).toBe(true)
	expect(deleteAccount).not.toHaveBeenCalled()
	expect(await prisma.user.count({ where: { id: userId } })).toBe(1)
})

test('Log Out still ends the session when deleting the demo user fails', async () => {
	await buildTemplate()
	const { userId, cookie } = await startDemo()
	vi.mocked(deleteAccount).mockRejectedValueOnce(new Error('disk full'))
	consoleError.mockImplementation(() => {})

	const response = await respond(() =>
		logoutAction(routeArgs(request('POST', '/logout', { cookie }), '/logout')),
	)

	expect(ended(response, 'en_session')).toBe(true)
	// The sweep deletes it when its time is up.
	expect(await prisma.user.count({ where: { id: userId } })).toBe(1)
	expect(consoleError).toHaveBeenCalled()
})
