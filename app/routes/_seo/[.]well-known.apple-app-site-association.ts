// Apple fetches this file (through its CDN) to let the iOS shell sign in with
// the site's passkeys (webcredentials) and open every useqm.app link in the
// app (applinks). It must be served as JSON with no redirect, auth, or rate
// limit; server/index.ts exempts both paths from the rate limiter.
//
// Without a Team ID there is no app to claim, so the file does not exist.

const DEFAULT_BUNDLE_ID = 'app.useqm.ios'

export function loader() {
	const teamId = process.env.APPLE_TEAM_ID?.trim()
	if (!teamId) {
		// no-store so the file shows up as soon as the Team ID is configured.
		return new Response(null, {
			status: 404,
			headers: { 'Cache-Control': 'no-store' },
		})
	}

	const bundleId = process.env.IOS_BUNDLE_ID?.trim() || DEFAULT_BUNDLE_ID
	const appId = `${teamId}.${bundleId}`

	return Response.json(
		{
			applinks: {
				// Required by Apple even though it is always empty.
				apps: [],
				details: [{ appIDs: [appId], components: [{ '/': '*' }] }],
			},
			webcredentials: { apps: [appId] },
		},
		{ headers: { 'Cache-Control': 'public, max-age=3600' } },
	)
}
