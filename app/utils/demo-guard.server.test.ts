/**
 * Failure list for the demo guard (the root middleware that keeps a demo user
 * out of account, Household, backup, billing and admin changes):
 *
 * 1. A demo user's POST to a blocked route reaches its action. It must be
 *    refused before the action runs.
 * 2. A refused form post answers with a bare 403 or an error page, so the user
 *    sees nothing useful. It must go back to the page it came from with the
 *    message as a toast. A caller that sends JSON (the passkey page) gets a
 *    403 with the message it can show.
 * 3. The way back follows a Referer from another site, or a path starting
 *    with `//`, off this site. It must stay here.
 * 4. A real user's POST to a blocked route is refused or changed. It must
 *    reach the action untouched.
 * 5. A signed-out POST to a blocked route reads the database. It must pass
 *    on without a read; the route checks sign-in itself.
 * 6. A demo user's GET or HEAD to a blocked route is refused, or reads the
 *    user. Pages must still load, with no lookup.
 * 7. A demo user's POST to an allowed route reads the user. It must pass
 *    with no lookup.
 * 8. PUT, PATCH and DELETE get through where POST doesn't.
 * 9. A `.data` request (every hydrated form) isn't matched, or goes back to
 *    the `.data` URL. It must be refused the same way and go back to the page.
 * 10. A route with params is matched on the URL instead of the pattern, so a
 *    URL that happens to spell a blocked route's path is refused, or a
 *    blocked route is missed.
 * 11. The pattern comes with a leading slash and nothing matches.
 * 12. A demo user whose time is up but who hasn't been removed yet is let
 *    through.
 * 13. A session cookie whose session is gone throws or is refused. It must
 *    pass to the route, which answers it as signed out.
 * 14. Checkout and the billing portal: the `/upgrade` action doesn't refuse a
 *    user who is already Pro, and the portal opens for any user with a
 *    Stripe customer. A demo user's POST to either must never reach Stripe.
 *
 * Failure list for the route classification:
 *
 * 15. A new route with an action ships without anyone deciding whether a
 *    demo user may use it. Every route that exports an action must be on
 *    the blocked or the allowed list.
 * 16. A list names a route that no longer exists or no longer has an action,
 *    so the list reads as covering something it doesn't.
 * 17. A route sits on both lists.
 * 18. An entry has no reason.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RouterContextProvider } from 'react-router'
import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { action as stripePortalAction } from '#app/routes/resources/stripe-portal.tsx'
import { action as upgradeAction } from '#app/routes/upgrade.tsx'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getStripeClient } from '#app/utils/stripe.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import {
	DEMO_ALLOWED_ROUTES,
	DEMO_BLOCKED_MESSAGE,
	DEMO_BLOCKED_ROUTES,
	demoGuardKey,
	demoGuardMiddleware,
} from './demo-guard.server.ts'
import { toastSessionStorage } from './toast.server.ts'
import '#tests/setup/db-setup.ts'

async function signedIn(demoExpiresAt: Date | null) {
	return prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...createUser(),
					demoExpiresAt,
					subscription: { create: { tier: 'pro' } },
				},
			},
		},
		select: { id: true, userId: true },
	})
}

const demoUser = () => signedIn(new Date(Date.now() + 60 * 60 * 1000))
const realUser = () => signedIn(null)

type Send = {
	method?: string
	session?: { id: string } | null
	path?: string
	referer?: string
	json?: boolean
}

async function request(pattern: string, send: Send = {}) {
	const urlPath = send.path ?? `/${pattern}`
	const headers = new Headers()
	if (send.session) {
		headers.set('cookie', await getSessionCookieHeader(send.session))
	}
	if (send.referer) headers.set('referer', send.referer)
	const method = send.method ?? 'POST'
	let body: BodyInit | undefined
	if (method !== 'GET' && method !== 'HEAD') {
		if (send.json) {
			headers.set('content-type', 'application/json')
			body = '{}'
		} else {
			body = new URLSearchParams({ intent: 'something' })
		}
	}
	return new Request(`${BASE_URL}${urlPath}`, { method, headers, body })
}

/** Runs the guard on `pattern`, with a route behind it that answers 200. */
async function guard(pattern: string, send: Send = {}) {
	const req = await request(pattern, send)
	const route = vi.fn(async () => new Response('the action ran'))
	const response = await demoGuardMiddleware(
		{
			request: req,
			pattern,
			params: {},
			url: new URL(req.url),
			context: new RouterContextProvider(),
		},
		route,
	)
	return { response: response as Response, ran: route.mock.calls.length > 0 }
}

async function toastIn(response: Response) {
	const cookie = response.headers
		.getSetCookie()
		.find((c) => c.startsWith('en_toast='))
	if (!cookie) return null
	const session = await toastSessionStorage.getSession(cookie.split(';')[0])
	return session.get('toast') as { description: string; type: string }
}

/** Counts session lookups, the guard's one read. */
function countReads() {
	const spy = vi.spyOn(prisma.session, 'findUnique')
	return {
		reads: () => spy.mock.calls.length,
		[Symbol.dispose]: () => spy.mockRestore(),
	}
}

describe('demoGuardMiddleware', () => {
	test("a demo user's form post to a blocked route goes back to the page with the message", async () => {
		const session = await demoUser()
		const { response, ran } = await guard('settings/profile/household', {
			session,
			referer: `${BASE_URL}/settings/profile/household`,
		})

		expect(ran).toBe(false)
		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/settings/profile/household')
		expect(await toastIn(response)).toMatchObject({
			type: 'error',
			description: DEMO_BLOCKED_MESSAGE,
		})
	})

	test("a demo user's JSON post to a blocked route gets a 403 with the message", async () => {
		const session = await demoUser()
		const { response, ran } = await guard('webauthn/registration', {
			session,
			json: true,
		})

		expect(ran).toBe(false)
		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({
			status: 'error',
			error: DEMO_BLOCKED_MESSAGE,
		})
	})

	test('the way back never leaves the site', async () => {
		const session = await demoUser()
		const elsewhere = await guard('upgrade', {
			session,
			referer: 'https://example.com/upgrade',
		})
		const slashes = await guard('upgrade', {
			session,
			referer: `${BASE_URL}//example.com/upgrade`,
		})
		const none = await guard('upgrade', { session })

		expect(elsewhere.response.headers.get('location')).toBe('/')
		expect(slashes.response.headers.get('location')).toBe('/')
		expect(none.response.headers.get('location')).toBe('/')
	})

	test("a real user's post to a blocked route reaches the action", async () => {
		const session = await realUser()
		const { response, ran } = await guard('settings/profile/household', {
			session,
		})

		expect(ran).toBe(true)
		expect(await response.text()).toBe('the action ran')
	})

	test('a signed-out post to a blocked route passes on without a read', async () => {
		using counter = countReads()
		const { ran } = await guard('settings/profile/household')

		expect(ran).toBe(true)
		expect(counter.reads()).toBe(0)
	})

	test("a demo user's GET and HEAD to a blocked route load, with no lookup", async () => {
		const session = await demoUser()
		using counter = countReads()
		const get = await guard('settings/profile/household', {
			session,
			method: 'GET',
		})
		const head = await guard('settings/profile/household', {
			session,
			method: 'HEAD',
		})

		expect(get.ran && head.ran).toBe(true)
		expect(counter.reads()).toBe(0)
	})

	test("a demo user's post to an allowed route passes with no lookup", async () => {
		const session = await demoUser()
		using counter = countReads()
		const { ran } = await guard('recipes/new', { session })

		expect(ran).toBe(true)
		expect(counter.reads()).toBe(0)
	})

	test('PUT, PATCH and DELETE are refused like POST', async () => {
		const session = await demoUser()
		for (const method of ['PUT', 'PATCH', 'DELETE']) {
			const { ran } = await guard('settings/profile/household', {
				session,
				method,
			})
			expect({ method, ran }).toEqual({ method, ran: false })
		}
	})

	test('a .data request is refused and goes back to the page', async () => {
		const session = await demoUser()
		const { response, ran } = await guard('settings/profile/two-factor', {
			session,
			path: '/settings/profile/two-factor.data?index',
			referer: `${BASE_URL}/settings/profile/two-factor`,
		})

		expect(ran).toBe(false)
		expect(response.headers.get('location')).toBe(
			'/settings/profile/two-factor',
		)
	})

	test('routes are matched on their pattern, not on the URL', async () => {
		const session = await demoUser()
		// An allowed route with a param whose URL spells a blocked route.
		const allowed = await guard('share/:recipeId', {
			session,
			path: '/share/upgrade',
		})
		// A blocked route reached by a URL that spells an allowed one.
		const blocked = await guard('settings/profile/household', {
			session,
			path: '/recipes/new',
		})

		expect(allowed.ran).toBe(true)
		expect(blocked.ran).toBe(false)
	})

	test('a pattern with a leading slash still matches', async () => {
		const session = await demoUser()
		const { ran } = await guard('/upgrade', { session, path: '/upgrade' })

		expect(ran).toBe(false)
	})

	test('a demo user whose time is up is still refused', async () => {
		const session = await signedIn(new Date(Date.now() - 60 * 1000))
		const { ran } = await guard('upgrade', { session })

		expect(ran).toBe(false)
	})

	test('a cookie whose session is gone passes to the route', async () => {
		const { ran } = await guard('upgrade', {
			session: { id: 'no-such-session' },
		})

		expect(ran).toBe(true)
	})
})

describe('checkout and the billing portal', () => {
	let stripeCalls: string[]

	beforeEach(() => {
		vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_demo_guard')
		vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_demo_guard_yearly')
		stripeCalls = []
		const stripe = getStripeClient()!
		vi.spyOn(stripe.checkout.sessions, 'create').mockImplementation((async (
			_params: Stripe.Checkout.SessionCreateParams,
		) => {
			stripeCalls.push('checkout')
			return { url: 'https://checkout.stripe.com/demo-guard-test' }
		}) as never)
		vi.spyOn(stripe.billingPortal.sessions, 'create').mockImplementation(
			(async () => {
				stripeCalls.push('portal')
				return { url: 'https://billing.stripe.com/demo-guard-test' }
			}) as never,
		)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	/** The guard with the real route action behind it. */
	async function post(
		pattern: string,
		action: typeof upgradeAction | typeof stripePortalAction,
		session: { id: string },
		fields: Record<string, string>,
	) {
		const headers = new Headers({
			cookie: await getSessionCookieHeader(session),
			referer: `${BASE_URL}/upgrade`,
		})
		const req = new Request(`${BASE_URL}/${pattern}`, {
			method: 'POST',
			headers,
			body: new URLSearchParams(fields),
		})
		const args = {
			request: req,
			pattern,
			params: {},
			url: new URL(req.url),
			context: new RouterContextProvider(),
		}
		return (await demoGuardMiddleware(args, async () => {
			const result: unknown = await action(args as never)
			return result as Response
		})) as Response
	}

	async function withStripeCustomer(session: { userId: string }) {
		await prisma.subscription.update({
			where: { userId: session.userId },
			data: { stripeCustomerId: `cus_${session.userId}` },
		})
	}

	test("a demo user's checkout never reaches Stripe", async () => {
		const session = await demoUser()

		const response = await post('upgrade', upgradeAction, session, {
			intent: 'checkout',
			plan: 'yearly',
		})

		expect(stripeCalls).toEqual([])
		expect(response.headers.get('location')).toBe('/upgrade')
		expect(await toastIn(response)).toMatchObject({
			description: DEMO_BLOCKED_MESSAGE,
		})
	})

	test("a demo user's billing portal never reaches Stripe", async () => {
		const session = await demoUser()
		await withStripeCustomer(session)

		const response = await post(
			'resources/stripe-portal',
			stripePortalAction,
			session,
			{},
		)

		expect(stripeCalls).toEqual([])
		expect(await toastIn(response)).toMatchObject({
			description: DEMO_BLOCKED_MESSAGE,
		})
	})

	test("a real user's checkout and portal still reach Stripe", async () => {
		const session = await realUser()
		await withStripeCustomer(session)

		const checkout = await post('upgrade', upgradeAction, session, {
			intent: 'checkout',
			plan: 'yearly',
		})
		const portal = await post(
			'resources/stripe-portal',
			stripePortalAction,
			session,
			{},
		)

		expect(stripeCalls).toEqual(['checkout', 'portal'])
		expect(checkout.headers.get('location')).toContain('checkout.stripe.com')
		expect(portal.headers.get('location')).toContain('billing.stripe.com')
	})
})

type RouteFile = { pattern: string; file: string }

/** Every route's pattern, spelled as React Router matches it, and its file. */
async function routeFiles(): Promise<RouteFile[]> {
	;(
		globalThis as { __reactRouterAppDirectory?: string }
	).__reactRouterAppDirectory = path.resolve('app')
	const { default: routes } = await import('#app/routes.ts')
	const found: RouteFile[] = []
	type Entry = { path?: string; file: string; children?: Entry[] }
	const walk = (entries: Entry[], parents: string[]) => {
		for (const entry of entries) {
			const parts = entry.path ? [...parents, entry.path] : parents
			found.push({
				pattern: demoGuardKey(parts.join('/').replace(/\/\/+/g, '/')),
				file: path.resolve('app', entry.file),
			})
			walk(entry.children ?? [], parts)
		}
	}
	walk(routes as Entry[], [])
	return found
}

const ACTION_EXPORT =
	/export\s+(async\s+)?function\s+action\b|export\s+(const|let|var)\s+action\b|export\s*\{[^}]*\baction\b[^}]*\}/

/** Routes added by other parts of the demo work that may not be here yet. */
const NOT_YET_HERE = new Set(['demo'])

describe('every route with an action is classified for demo users', () => {
	test('each route that exports an action is blocked or allowed', async () => {
		const withAction = (await routeFiles()).filter((route) =>
			ACTION_EXPORT.test(readFileSync(route.file, 'utf8')),
		)
		expect(withAction.length).toBeGreaterThan(30)
		const unclassified = withAction
			.map((route) => route.pattern)
			.filter(
				(pattern) =>
					!(pattern in DEMO_BLOCKED_ROUTES) &&
					!(pattern in DEMO_ALLOWED_ROUTES),
			)
		expect(unclassified).toEqual([])
	})

	test('each listed route exists and has an action', async () => {
		const withAction = new Set(
			(await routeFiles())
				.filter((route) => ACTION_EXPORT.test(readFileSync(route.file, 'utf8')))
				.map((route) => route.pattern),
		)
		const listed = [
			...Object.keys(DEMO_BLOCKED_ROUTES),
			...Object.keys(DEMO_ALLOWED_ROUTES),
		].filter((pattern) => !NOT_YET_HERE.has(pattern))
		expect(listed.filter((pattern) => !withAction.has(pattern))).toEqual([])
	})

	test('no route is on both lists, and every entry gives a reason', () => {
		const both = Object.keys(DEMO_BLOCKED_ROUTES).filter(
			(pattern) => pattern in DEMO_ALLOWED_ROUTES,
		)
		expect(both).toEqual([])
		for (const [pattern, reason] of [
			...Object.entries(DEMO_BLOCKED_ROUTES),
			...Object.entries(DEMO_ALLOWED_ROUTES),
		]) {
			expect({ pattern, reason: reason.trim().length > 0 }).toEqual({
				pattern,
				reason: true,
			})
		}
	})
})
