import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getPasswordHash } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL } from '#tests/utils.ts'
import { action as loginAction } from './login.tsx'
import { action as logoutAction } from './logout.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

function args(request: Request, pattern: string) {
	return {
		request,
		url: new URL(request.url),
		params: {},
		pattern,
		context: new RouterContextProvider(),
	}
}

async function logOut(redirectTo: string) {
	const request = new Request(`${BASE_URL}/logout`, {
		method: 'POST',
		body: new URLSearchParams({ redirectTo }),
	})
	const result: unknown = await logoutAction(args(request, '/logout')).catch(
		(thrown: unknown) => thrown,
	)
	return (result as Response).headers.get('location')
}

// Logout takes redirectTo from the form, and a form on another site can post
// one. A value browsers would turn into another site's address goes to the
// homepage.
test.each([
	'/\t/evil.com',
	'/\n/evil.com',
	'/\r/evil.com',
	'/ /evil.com',
	'/\\evil.com',
])('logout refuses %j as the place to go', async (redirectTo) => {
	expect(await logOut(redirectTo)).toBe('/')
})

test('logout comes back to an ordinary path', async () => {
	expect(await logOut('/verify?type=onboarding&target=x&token=t')).toBe(
		'/verify?type=onboarding&target=x&token=t',
	)
})

// Login's ?redirectTo=/%09/evil.com arrives in the form decoded, with a real
// tab.
test('login with a percent-encoded tab in redirectTo goes to Recipes', async () => {
	const { username } = createUser()
	const user = await prisma.user.create({
		data: {
			...createUser(),
			username,
			password: { create: { hash: await getPasswordHash(username) } },
		},
		select: { username: true },
	})
	// What the login page's GET hands to its form.
	const redirectTo = new URL(
		`${BASE_URL}/login?redirectTo=/%09/evil.com`,
	).searchParams.get('redirectTo')!
	expect(redirectTo).toBe('/\t/evil.com')

	const request = new Request(`${BASE_URL}/login`, {
		method: 'POST',
		body: new URLSearchParams({
			username: user.username,
			password: user.username,
			redirectTo,
		}),
	})
	const response = (await loginAction(args(request, '/login'))) as Response

	expect(response.headers.get('location')).toBe('/recipes')
})
