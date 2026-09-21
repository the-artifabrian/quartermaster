import { parseWithZod } from '@conform-to/zod/v4'
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { BASE_URL } from '#tests/utils.ts'
import { handleVerification } from './onboarding/index.server.ts'
import { action } from './signup.tsx'
import { VerifySchema } from './verify.tsx'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

test('email signup and verification retain the destination shared Menu', async () => {
	const redirectTo = '/share/menus/terrace-dinner'
	const url = new URL(`${BASE_URL}/signup`)
	const request = new Request(url, {
		method: 'POST',
		body: new URLSearchParams({ email: 'menu-reader@example.com', redirectTo }),
	})
	const response = await action({
		request,
		url,
		params: {},
		pattern: '/signup',
		context: new RouterContextProvider(),
	})
	expect(response).toBeInstanceOf(Response)
	const verifyUrl = new URL(
		(response as Response).headers.get('location')!,
		BASE_URL,
	)
	expect(verifyUrl.pathname).toBe('/verify')
	expect(verifyUrl.searchParams.get('redirectTo')).toBe(redirectTo)
	const body = new URLSearchParams({
		code: 'ABC123',
		type: 'onboarding',
		target: 'menu-reader@example.com',
		redirectTo,
	})
	const submission = parseWithZod(body, { schema: VerifySchema })
	const verified = await handleVerification({ request, body, submission })
	expect(
		new URL(verified.headers.get('location')!, BASE_URL).searchParams.get(
			'redirectTo',
		),
	).toBe(redirectTo)
	expect(verified.headers.get('set-cookie')).toBeTruthy()
})
