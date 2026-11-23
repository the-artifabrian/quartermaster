import { expect, test } from '@playwright/test'

// Checks on the built server's answers that no page flow shows.

test('responses do not name the server framework', async ({ request }) => {
	const page = await request.get('/login')
	const asset = await request.get('/favicon.ico')

	expect(page.status()).toBe(200)
	expect(page.headers()['x-powered-by']).toBeUndefined()
	expect(asset.headers()['x-powered-by']).toBeUndefined()
})

test('a POST with no form body answers 400', async ({ request }) => {
	// No body and no content type, as a bot sends it.
	const page = await request.post('/login', { maxRedirects: 0 })
	const data = await request.post('/signup.data', { maxRedirects: 0 })
	const text = await request.post('/forgot-password', {
		headers: { 'content-type': 'text/plain' },
		data: 'email=ada@example.com',
		maxRedirects: 0,
	})

	expect(page.status()).toBe(400)
	expect(data.status()).toBe(400)
	expect(text.status()).toBe(400)
})
