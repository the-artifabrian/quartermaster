import { afterEach, describe, expect, test, vi } from 'vitest'
import { loader as wellKnownLoader } from './[.]well-known.apple-app-site-association.ts'
import { loader as rootLoader } from './apple-app-site-association.ts'

type AppSiteAssociation = {
	applinks: { details: Array<{ appIDs: string[] }> }
	webcredentials: { apps: string[] }
}

async function readBody(response: Response) {
	return (await response.json()) as AppSiteAssociation
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('apple-app-site-association', () => {
	test('is 404 with an empty body when the Team ID is unset', async () => {
		vi.stubEnv('APPLE_TEAM_ID', undefined)

		const response = await wellKnownLoader()

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('')
	})

	test('treats a present-but-empty Team ID as unset', async () => {
		vi.stubEnv('APPLE_TEAM_ID', '')

		const response = await wellKnownLoader()

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('')
	})

	test('does not let a 404 linger in caches once the Team ID is set', async () => {
		vi.stubEnv('APPLE_TEAM_ID', '')

		const response = await wellKnownLoader()

		expect(response.headers.get('Cache-Control')).toBe('no-store')
	})

	test('serves JSON when the Team ID is set', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')

		const response = await wellKnownLoader()

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toMatch(/^application\/json\b/)
	})

	test('claims the default bundle for passkeys and every universal link', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')
		vi.stubEnv('IOS_BUNDLE_ID', undefined)

		const response = await wellKnownLoader()

		expect(await response.json()).toEqual({
			applinks: {
				apps: [],
				details: [
					{
						appIDs: ['ABCDE12345.app.useqm.ios'],
						components: [{ '/': '*' }],
					},
				],
			},
			webcredentials: { apps: ['ABCDE12345.app.useqm.ios'] },
		})
	})

	test('honours a custom bundle id in both sections', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')
		vi.stubEnv('IOS_BUNDLE_ID', 'app.useqm.ios.dev')

		const body = await readBody(wellKnownLoader())

		expect(body.applinks.details[0]?.appIDs).toEqual([
			'ABCDE12345.app.useqm.ios.dev',
		])
		expect(body.webcredentials.apps).toEqual(['ABCDE12345.app.useqm.ios.dev'])
	})

	test('treats a present-but-empty bundle id as the default', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')
		vi.stubEnv('IOS_BUNDLE_ID', '')

		const body = await readBody(wellKnownLoader())

		expect(body.webcredentials.apps).toEqual(['ABCDE12345.app.useqm.ios'])
	})

	test('trims whitespace a pasted secret carries', async () => {
		vi.stubEnv('APPLE_TEAM_ID', ' ABCDE12345\n')
		vi.stubEnv('IOS_BUNDLE_ID', 'app.useqm.ios\n')

		const body = await readBody(wellKnownLoader())

		expect(body.webcredentials.apps).toEqual(['ABCDE12345.app.useqm.ios'])
	})

	test('lets Apple and its CDN cache the file for an hour', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')

		const response = await wellKnownLoader()

		expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
	})

	test('never sets a cookie', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')
		const found = await wellKnownLoader()
		vi.stubEnv('APPLE_TEAM_ID', '')
		const missing = await wellKnownLoader()

		expect(found.headers.get('Set-Cookie')).toBeNull()
		expect(missing.headers.get('Set-Cookie')).toBeNull()
	})

	test('serves the same file at the root path Apple also tries', async () => {
		vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345')

		const wellKnown = await wellKnownLoader()
		const root = await rootLoader()

		expect(root.status).toBe(wellKnown.status)
		expect(Object.fromEntries(root.headers)).toEqual(
			Object.fromEntries(wellKnown.headers),
		)
		expect(await root.text()).toBe(await wellKnown.text())
	})
})
