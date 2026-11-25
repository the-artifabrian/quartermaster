import { redirect, RouterContextProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { clientAction } from './import.tsx'

// Failure list for the import's offline reply:
// - a redirect (to log in, to the saved Recipe) still navigates
// - a server error rebuilt as a client TypeError still reaches the error page
// - each browser's own network failure message comes back as the tab's error,
//   with a non-2xx status so the loaders do not run again offline
// - while the browser says it is offline, any TypeError counts as offline
// - a request with no import intent still throws
// - a result passes through untouched

function args(intent: string | null, serverAction: () => Promise<unknown>) {
	const body = new URLSearchParams(intent ? { intent } : {})
	return {
		request: new Request('https://useqm.app/recipes/import', {
			method: 'POST',
			body,
		}),
		serverAction,
		params: {},
		context: new RouterContextProvider(),
	} as unknown as Parameters<typeof clientAction>[0]
}

afterEach(() => {
	vi.unstubAllGlobals()
})

type OfflineReply = {
	type: 'DataWithResponseInit'
	data: { intent: string; error: string; existing: null }
	init: { status: number } | null
}

test('a redirect still navigates', async () => {
	const login = redirect('/login?redirectTo=%2Frecipes%2Fimport')
	await expect(
		clientAction(args('fetch', () => Promise.reject(login))),
	).rejects.toBe(login)
})

test('a server error rebuilt as a TypeError still reaches the error page', async () => {
	const error = new TypeError(
		"Cannot read properties of undefined (reading 'fetch')",
	)
	await expect(
		clientAction(args('extract-image', () => Promise.reject(error))),
	).rejects.toBe(error)
})

// Which errors count as a network failure: network-failure.test.ts.
test.each([['Failed to fetch'], ['Load failed']])(
	'a network failure (“%s”) is the tab’s error, says to check Recipes, and stops the reload',
	async (message) => {
		const reply = (await clientAction(
			args('extract-image', () => Promise.reject(new TypeError(message))),
		)) as unknown as OfflineReply
		expect(reply.type).toBe('DataWithResponseInit')
		expect(reply.init?.status).toBe(503)
		expect(reply.data).toEqual({
			intent: 'extract-image',
			error: expect.stringContaining('Check your Recipes'),
			existing: null,
		})
	},
)

test('while the browser is offline any TypeError counts as offline', async () => {
	vi.stubGlobal('navigator', { onLine: false })
	const reply = (await clientAction(
		args('fetch', () => Promise.reject(new TypeError('Something else'))),
	)) as unknown as OfflineReply
	expect(reply.init?.status).toBe(503)
	expect(reply.data.intent).toBe('fetch')
})

test('a request with no import intent still throws', async () => {
	const error = new TypeError('Failed to fetch')
	await expect(
		clientAction(args(null, () => Promise.reject(error))),
	).rejects.toBe(error)
	await expect(
		clientAction(args('delete', () => Promise.reject(error))),
	).rejects.toBe(error)
})

test('a result passes through', async () => {
	const result = {
		intent: 'fetch',
		error: 'Couldn’t open that page (error 404)',
	}
	expect(await clientAction(args('fetch', () => Promise.resolve(result)))).toBe(
		result,
	)
})
