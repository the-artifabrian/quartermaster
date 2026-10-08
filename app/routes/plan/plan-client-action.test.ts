import { redirect, RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { clientAction } from './index.tsx'

function args(intent: string, serverAction: () => Promise<unknown>) {
	return {
		request: new Request('https://useqm.app/plan', {
			method: 'POST',
			body: new URLSearchParams({ intent }),
		}),
		serverAction,
		params: {},
		context: new RouterContextProvider(),
	} as unknown as Parameters<typeof clientAction>[0]
}

test('a failed Recipe add comes back as an error result', async () => {
	const result = await clientAction(
		args('addMeal', () => Promise.reject(new Error('Unexpected Server Error'))),
	)
	expect(result).toEqual({ status: 'error' })
})

test('a redirect from a Recipe add, such as to log in, still navigates', async () => {
	const login = redirect('/login?redirectTo=%2Fplan')
	await expect(
		clientAction(args('addMeal', () => Promise.reject(login))),
	).rejects.toBe(login)
})

test('a failure of any other Plan change still reaches the error boundary', async () => {
	const error = new Error('Unexpected Server Error')
	await expect(
		clientAction(args('addMenu', () => Promise.reject(error))),
	).rejects.toBe(error)
})

test('a successful add passes its result through', async () => {
	const ok = { status: 'success' as const }
	expect(await clientAction(args('addMeal', () => Promise.resolve(ok)))).toBe(
		ok,
	)
})
