import { expect, test } from '@playwright/test'

// playwright.config.ts gives the web server a made-up APPLE_TEAM_ID.
for (const path of [
	'/.well-known/apple-app-site-association',
	'/apple-app-site-association',
]) {
	test(`serves the app-site-association file at ${path}`, async ({
		request,
	}) => {
		// Apple does not follow redirects, so one must fail the test.
		const response = await request.get(path, { maxRedirects: 0 })

		expect(response.status()).toBe(200)
		expect(new URL(response.url()).pathname).toBe(path)
		const headers = response.headers()
		expect(headers['content-type']).toMatch(/^application\/json/)
		expect(headers['cache-control']).toBe('public, max-age=3600')
		expect(headers['set-cookie']).toBeUndefined()
		// The rate limiter stamps these on every request it counts.
		expect(headers['ratelimit-policy']).toBeUndefined()

		const body = (await response.json()) as {
			applinks: { details: Array<{ appIDs: string[] }> }
			webcredentials: { apps: string[] }
		}
		const appId = body.applinks.details[0]?.appIDs[0]
		expect(appId).toMatch(/^[A-Z0-9]{10}\.app\.useqm\.ios$/)
		expect(body.webcredentials.apps).toEqual([appId])

		const head = await request.head(path, { maxRedirects: 0 })
		expect(head.status()).toBe(200)
		expect(head.headers()['content-type']).toMatch(/^application\/json/)
	})
}
