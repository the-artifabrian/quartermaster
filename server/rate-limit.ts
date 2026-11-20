export type RateLimitTier = 'none' | 'auth' | 'ai' | 'strong' | 'general'

/**
 * Sign-in and sign-out, sign-up, codes, passkeys, Household invites, account
 * settings and admin: any method but GET.
 */
export const authPaths = [
	'/login',
	'/logout',
	'/auth',
	'/signup',
	'/verify',
	'/onboarding',
	'/reset-password',
	'/forgot-password',
	'/webauthn',
	'/household/join',
	'/settings/profile',
	'/admin',
]

/** Routes that call a paid AI service on POST. */
export const aiPaths = [
	'/recipes/import',
	'/resources/enhance-recipe',
	'/resources/transcribe',
]

/** GETs that do more work than a page load: passkey challenges. */
export const strongGetPaths = ['/webauthn']

// Apple's CDN fetches the app-site-association file from shared addresses; a
// 429 there breaks passkey login and universal links for every iOS user.
const unthrottledPaths = new Set([
	'/.well-known/apple-app-site-association',
	'/apple-app-site-association',
])

/**
 * The path as the router matches it: dot segments resolved (also when
 * escaped), backslashes as slashes, single slashes, decoded,
 * case-insensitive, and without the `.data` suffix of a router data request.
 */
function routePath(path: string) {
	const slashed = `/${path.replace(/\\/g, '/').replace(/^\/+/, '')}`.replace(
		/\/+/g,
		'/',
	)
	let resolved = slashed
	try {
		resolved = new URL(slashed, 'http://x').pathname
	} catch {
		// Keep the slashed form.
	}
	let decoded = resolved
	try {
		decoded = decodeURIComponent(resolved)
	} catch {
		// Leave a malformed escape as it is.
	}
	return decoded
		.toLowerCase()
		.replace(/\/+/g, '/')
		.replace(/\.data$/, '')
		.replace(/(.)\/$/, '$1')
}

function under(path: string, prefixes: string[]) {
	return prefixes.some((p) => path === p || path.startsWith(`${p}/`))
}

export function rateLimitTier(method: string, rawPath: string): RateLimitTier {
	const path = routePath(rawPath)
	if (method === 'GET' || method === 'HEAD') {
		if (unthrottledPaths.has(path)) return 'none'
		if (under(path, strongGetPaths)) return 'strong'
		return 'general'
	}
	if (under(path, authPaths)) return 'auth'
	if (under(path, aiPaths)) return 'ai'
	return 'strong'
}
