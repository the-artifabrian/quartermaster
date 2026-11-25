import { type MiddlewareFunction, replace } from 'react-router'
import { sessionKey } from './auth.server.ts'
import { prisma } from './db.server.ts'
import { DEMO_BLOCKED_MESSAGE, isDemoUser } from './demo.ts'
import { authSessionStorage } from './session.server.ts'
import { createToastHeaders } from './toast.server.ts'

export { DEMO_BLOCKED_MESSAGE }

/**
 * Routes a demo user can't change anything through, by route pattern as
 * React Router matches it. Only GET and HEAD reach them. Each reason says
 * what the route changes.
 */
export const DEMO_BLOCKED_ROUTES = {
	'settings/profile/change-email': "Changes the account's email.",
	'settings/profile/edit': "Changes the account's username and name.",
	'settings/profile/password': 'Sets or changes a password.',
	'settings/profile/passkeys': 'Removes a passkey.',
	'webauthn/registration': 'Adds a passkey.',
	'settings/profile/two-factor': 'Starts setting up two-factor.',
	'settings/profile/two-factor/verify': 'Turns two-factor on.',
	'settings/profile/two-factor/disable': 'Turns two-factor off.',
	'settings/profile/household':
		'Renames the Household, invites, removes a member or leaves.',
	'household/join': 'Joins another Household by invite.',
	'settings/profile/import': 'Restores a JSON backup.',
	upgrade: 'Starts a Stripe checkout.',
	'resources/stripe-portal': 'Opens the Stripe billing portal.',
	'admin/subscriptions': 'Admin.',
} as const satisfies Record<string, string>

/**
 * Every other route with an action, and why a demo user may use it. The
 * classification test fails on a route with an action that is in neither
 * list, so a new one gets a decision before it ships.
 */
export const DEMO_ALLOWED_ROUTES = {
	'recipes/new': 'Recipes are the point of the demo. A new photo is dropped.',
	'recipes/:recipeId/edit':
		'Recipes are the point of the demo. A new photo is dropped.',
	'recipes/:recipeId': 'Recipes: favourite, enhance, add to Plan or Shopping.',
	'recipes/import': 'Imports, with AI under the demo caps.',
	'recipes/menus/new': 'Menus.',
	'recipes/menus/:menuId': 'Menus: add to Plan or Shopping.',
	'recipes/menus/:menuId/edit': 'Menus.',
	plan: 'The Plan.',
	shopping: 'Shopping.',
	staples: 'Staples.',
	'resources/shopping-check': 'Checks Shopping rows.',
	'resources/undo-delete': 'Deletes and restores Meals, Shopping and Staples.',
	'resources/enhance-recipe': 'AI, under the demo caps.',
	'resources/transcribe': 'AI, under the demo caps.',
	'resources/theme-switch': 'Saves the theme in a cookie.',
	'share/:recipeId':
		'Saves a shared Recipe into the demo Household. Demo Recipes are never shown there.',
	'share/menus/:menuId':
		'Saves a shared Menu into the demo Household. Demo Menus are never shown there.',
	'settings/profile':
		'Signs out other sessions, or deletes the account, which ends the demo early.',
	login: 'Signs in to another account.',
	logout: 'Signs out.',
	signup: 'Starts an account of their own.',
	onboarding: 'Finishes an account of their own.',
	verify:
		'Checks a code. Every flow that sends one for a demo account is blocked.',
	'forgot-password':
		'Sends a code to the address typed. A demo address gets none.',
	'reset-password': 'Needs a code from email, which a demo address never gets.',
	'webauthn/authentication': 'Signs in with a passkey.',
	demo: 'Starts or ends a demo.',
	'resources/stripe-webhook': 'Called by Stripe, never with a session.',
	'*': 'Answers not found.',
} as const satisfies Record<string, string>

/**
 * Layout routes with an action of their own whose pattern an index route
 * shares, by route id. The lists key on pattern, so such a layout gets its
 * index route's verdict; each one listed here says why that verdict fits it
 * too. There are none today.
 */
export const DEMO_LAYOUT_ACTIONS: Record<string, string> = {}

/** A pattern as these lists spell it: no leading slash, the index route as `/`. */
export function demoGuardKey(pattern: string) {
	return pattern.replace(/^\/+/, '') || '/'
}

const BLOCKED = new Set<string>(Object.keys(DEMO_BLOCKED_ROUTES))

/** Whether a request to `pattern` with `method` is refused for a demo user. */
export function isBlockedForDemo(method: string, pattern: string) {
	if (method === 'GET' || method === 'HEAD') return false
	return BLOCKED.has(demoGuardKey(pattern))
}

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data']

/**
 * The page to go back to: the Referer's path when it is this site's. Only
 * the path is kept, and never one that starts with `//`, so the redirect
 * stays on this site.
 */
function pageBack(request: Request) {
	const referer = request.headers.get('referer')
	if (!referer) return '/'
	try {
		const from = new URL(referer)
		if (from.host !== new URL(request.url).host) return '/'
		if (from.pathname.startsWith('//')) return '/'
		return `${from.pathname}${from.search}`
	} catch {
		return '/'
	}
}

/**
 * The answer to a refused request. A hydrated form's submit (a `.data`
 * request, whatever its body) and a form posted without JavaScript go back
 * to the page with the message as a toast: a Response returned here would
 * replace the page, and a redirect is the one answer React Router passes to
 * the page as it is. Anything else, such as the passkey page's JSON, gets a
 * 403 with the message in the shape that page reads.
 */
async function refuse(request: Request) {
	const mediaType =
		request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
		''
	const fromRouter = new URL(request.url).pathname.endsWith('.data')
	if (fromRouter || FORM_TYPES.includes(mediaType)) {
		return replace(pageBack(request), {
			headers: await createToastHeaders({
				type: 'error',
				description: DEMO_BLOCKED_MESSAGE,
			}),
		})
	}
	return Response.json(
		{ status: 'error', error: DEMO_BLOCKED_MESSAGE },
		{ status: 403 },
	)
}

/** Whether the user is a demo user. One read. */
export async function isDemoUserId(userId: string) {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { demoExpiresAt: true },
	})
	return user ? isDemoUser(user) : false
}

/**
 * What a demo user's Recipe save says when it left out the photo they
 * picked. Photos aren't stored for the demo: the Recipe forms drop a demo
 * user's file without checking or storing it. A hydrated form shows it as it
 * leaves (EditScreenDone's `notice`); a redirect carries it in a toast.
 */
export const DEMO_PHOTO_DROPPED_MESSAGE =
	'Saved without the photo. Photos are turned off in the demo.'

export function demoPhotoDroppedHeaders() {
	return createToastHeaders({
		type: 'message',
		description: DEMO_PHOTO_DROPPED_MESSAGE,
	})
}

/**
 * Whether the signed-in user, if any, is a demo user. One read, by session,
 * and none without a session cookie.
 */
export async function isDemoSession(request: Request) {
	const cookie = request.headers.get('cookie')
	if (!cookie) return false
	const authSession = await authSessionStorage.getSession(cookie)
	const sessionId: unknown = authSession.get(sessionKey)
	if (typeof sessionId !== 'string') return false
	const session = await prisma.session.findUnique({
		where: { id: sessionId },
		select: { user: { select: { demoExpiresAt: true } } },
	})
	return session ? isDemoUser(session.user) : false
}

/**
 * Refuses a demo user's change through a route in DEMO_BLOCKED_ROUTES before
 * its action runs. GET and HEAD, and routes not on the list, pass without a
 * look at the user. A signed-out request or a real user's passes through as
 * it came; the route still checks its own sign-in.
 */
export const demoGuardMiddleware: MiddlewareFunction<Response> = async (
	{ request, pattern },
	next,
) => {
	if (!isBlockedForDemo(request.method, pattern)) return next()
	if (await isDemoSession(request)) return refuse(request)
	return next()
}
