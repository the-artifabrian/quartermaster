import {
	existsSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
	aiPaths,
	authPaths,
	rateLimitTier,
	strongGetPaths,
} from './rate-limit.ts'

// Failure list: what could leave a sensitive route on a loose limit.
//
// 1. Sign-in, sign-up, code and passkey submissions get the auth tier,
//    including the router's `.data` form of the same URL.
// 2. The router matches paths case-insensitively, decoded and with dot
//    segments resolved, so /LOGIN, /%6Cogin, //login, /x/../login,
//    /x/%2e%2e/login and /\login get the same tier as /login.
// 3. A path that only starts with the same letters (/login-help) is not a
//    sign-in route.
// 4. AI routes that cost money (Recipe import, enhance, transcribe) get the
//    AI tier on POST.
// 5. Passkey option GETs get the strong tier; ordinary page loads stay on the
//    general tier.
// 6. Apple's association file is never throttled on GET.
// 7. Every listed path is a real route, so a renamed route can't silently
//    drop out of its tier.
// 8. Every action under _auth, every other action that checks a password or
//    code, takes an invite or sends an email (such as /household/join), and
//    every route that reaches a paid AI helper is on a strict tier, so a new
//    route can't land on the loose one.
// 9. The import scanner behind 8 follows dynamic import(), re-exports,
//    double quotes, extensionless specifiers and long chains, and skips
//    type-only imports; it finds `export const action` and re-exported
//    actions.

describe('rate limit tier', () => {
	test.each([
		'/login',
		'/login.data',
		'/signup',
		'/verify',
		'/onboarding',
		'/onboarding/google',
		'/reset-password',
		'/forgot-password',
		'/webauthn/authentication',
		'/webauthn/registration',
		'/settings/profile/two-factor/verify',
		'/settings/profile/password',
		'/admin/users',
	])('POST %s is on the auth tier', (p) => {
		expect(rateLimitTier('POST', p)).toBe('auth')
	})

	test.each([
		'/LOGIN',
		'/%6Cogin',
		'//login',
		'/Login.data',
		'/x/../login',
		'/x/%2e%2e/login',
		'/\\login',
		'\\login',
	])('POST %s is treated like /login', (p) => {
		expect(rateLimitTier('POST', p)).toBe('auth')
	})

	test.each(['/login-help', '/recipes/login', '/verifying'])(
		'POST %s is not a sign-in route',
		(p) => {
			expect(rateLimitTier('POST', p)).toBe('strong')
		},
	)

	test.each([
		'/recipes/import',
		'/recipes/import.data',
		'/resources/enhance-recipe',
		'/resources/transcribe',
	])('POST %s is on the AI tier', (p) => {
		expect(rateLimitTier('POST', p)).toBe('ai')
	})

	test('POST to other routes is on the strong tier', () => {
		expect(rateLimitTier('POST', '/recipes/abc123')).toBe('strong')
		expect(rateLimitTier('DELETE', '/resources/undo-delete')).toBe('strong')
	})

	test('passkey option GETs are on the strong tier', () => {
		expect(rateLimitTier('GET', '/webauthn/authentication')).toBe('strong')
		expect(rateLimitTier('GET', '/webauthn/registration')).toBe('strong')
	})

	test.each(['/login', '/recipes', '/recipes/import', '/verify'])(
		'GET %s is on the general tier',
		(p) => {
			expect(rateLimitTier('GET', p)).toBe('general')
		},
	)

	test("Apple's association file is not throttled on GET", () => {
		expect(
			rateLimitTier('GET', '/.well-known/apple-app-site-association'),
		).toBe('none')
		expect(rateLimitTier('HEAD', '/apple-app-site-association')).toBe('none')
		expect(rateLimitTier('POST', '/apple-app-site-association')).toBe('strong')
	})

	test('every listed path is a real route', async () => {
		const routePaths = (await routeFiles()).map((route) => route.path)

		const listed = [...authPaths, ...aiPaths, ...strongGetPaths]
		expect(listed.length).toBeGreaterThan(0)
		for (const listedPath of listed) {
			expect(
				routePaths.some(
					(r) => r === listedPath || r.startsWith(`${listedPath}/`),
				),
				`${listedPath} matches no route`,
			).toBe(true)
		}
	})
})

type RouteFile = { path: string; file: string }

/** Every route's URL path and its file under app/. */
async function routeFiles(): Promise<RouteFile[]> {
	;(
		globalThis as { __reactRouterAppDirectory?: string }
	).__reactRouterAppDirectory = path.resolve('app')
	const { default: routes } = await import('#app/routes.ts')
	const found: RouteFile[] = []
	type Entry = { path?: string; file: string; children?: Entry[] }
	const walk = (entries: Entry[], base: string) => {
		for (const entry of entries) {
			const full = entry.path ? `${base}/${entry.path}` : base
			found.push({ path: full || '/', file: path.resolve('app', entry.file) })
			walk(entry.children ?? [], full)
		}
	}
	walk(routes as Entry[], '')
	return found
}

/** Whether an import or export clause names only types. */
function onlyTypes(clause: string) {
	const trimmed = clause.trim()
	if (trimmed.startsWith('type ')) return true
	const names = /\{([^}]*)\}/.exec(trimmed)?.[1]
	if (names === undefined) return false
	const outside = trimmed
		.replace(/\{[^}]*\}/, '')
		.replace(/,/g, '')
		.trim()
	if (outside) return false
	const list = names
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean)
	return list.length > 0 && list.every((name) => name.startsWith('type '))
}

/**
 * The modules a file loads at run time: static imports and re-exports that
 * aren't type-only, side-effect imports, and dynamic import() calls.
 */
function moduleSpecifiers(file: string) {
	const source = readFileSync(file, 'utf8')
	const specifiers: string[] = []
	const staticForms =
		/^\s*(import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm
	for (const [, , clause, specifier] of source.matchAll(staticForms)) {
		if (!onlyTypes(clause!)) specifiers.push(specifier!)
	}
	for (const [, specifier] of source.matchAll(
		/^\s*import\s+['"]([^'"]+)['"]/gm,
	)) {
		specifiers.push(specifier!)
	}
	for (const [, specifier] of source.matchAll(
		/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
	)) {
		specifiers.push(specifier!)
	}
	return specifiers
}

function isFile(candidate: string) {
	return existsSync(candidate) && statSync(candidate).isFile()
}

/** The file a `#app/` or relative specifier loads, with or without extension. */
function resolveImport(from: string, specifier: string) {
	const base = specifier.startsWith('#app/')
		? path.resolve('app', specifier.slice('#app/'.length))
		: specifier.startsWith('.')
			? path.resolve(path.dirname(from), specifier)
			: null
	if (!base) return null
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		path.join(base, 'index.ts'),
		path.join(base, 'index.tsx'),
	]
	return candidates.find(isFile) ?? null
}

/**
 * Whether `file` reaches a module whose specifier matches `target`,
 * following run-time imports. `follow` picks which specifiers to walk into.
 */
function reaches(
	file: string,
	target: RegExp,
	follow: (specifier: string) => boolean,
	seen = new Set<string>(),
): boolean {
	if (seen.has(file)) return false
	seen.add(file)
	return moduleSpecifiers(file).some((specifier) => {
		if (target.test(specifier)) return true
		if (!follow(specifier)) return false
		const next = resolveImport(file, specifier)
		return next ? reaches(next, target, follow, seen) : false
	})
}

/** The file and every file it reaches through relative imports. */
function localFiles(file: string, seen = new Set<string>()): string[] {
	if (seen.has(file)) return []
	seen.add(file)
	for (const specifier of moduleSpecifiers(file)) {
		if (!specifier.startsWith('.')) continue
		const next = resolveImport(file, specifier)
		if (next) localFiles(next, seen)
	}
	return [...seen]
}

const AI_HELPERS =
	/recipe-extract-llm|recipe-enhance-llm|speech-parse-llm|whisper\.server|anthropic-json/

// Calls that check a password or code, take an invite, or send an email.
const AUTH_LIKE_CALLS =
	/\b(prepareVerification|isCodeValid|validateRequest|issueEmailCode|checkEmailCode|consumeEmailCode|verifyUserPassword|resetUserPassword|getInviteByToken|acceptInvite|sendEmail)\s*\(/

const ACTION_EXPORT =
	/export\s+(async\s+)?function\s+action\b|export\s+(const|let|var)\s+action\b|export\s*\{[^}]*\baction\b[^}]*\}/

function hasAction(file: string) {
	return ACTION_EXPORT.test(readFileSync(file, 'utf8'))
}

function postTier(routePath: string) {
	return rateLimitTier('POST', routePath.replace(/:\w+/g, 'x'))
}

describe('new routes land on a strict tier', () => {
	test('every action under _auth is on the auth tier', async () => {
		const authRoutes = (await routeFiles()).filter(
			(route) =>
				route.file.includes(`${path.sep}routes${path.sep}_auth${path.sep}`) &&
				hasAction(route.file),
		)
		expect(authRoutes.length).toBeGreaterThan(5)
		for (const route of authRoutes) {
			expect({ route: route.path, tier: postTier(route.path) }).toEqual({
				route: route.path,
				tier: 'auth',
			})
		}
	})

	test('every other action that checks a password or code, takes an invite or sends an email is on the auth tier', async () => {
		const authLike = (await routeFiles()).filter(
			(route) =>
				hasAction(route.file) &&
				localFiles(route.file).some((file) =>
					AUTH_LIKE_CALLS.test(readFileSync(file, 'utf8')),
				),
		)
		expect(authLike.map((route) => route.path)).toEqual(
			expect.arrayContaining([
				'/household/join',
				'/forgot-password',
				// Adding a passkey checks the current password.
				'/webauthn/registration',
			]),
		)
		for (const route of authLike) {
			expect({ route: route.path, tier: postTier(route.path) }).toEqual({
				route: route.path,
				tier: 'auth',
			})
		}
	})

	test('every route that reaches a paid AI helper is on a strict tier', async () => {
		const aiRoutes = (await routeFiles()).filter((route) =>
			reaches(
				route.file,
				AI_HELPERS,
				(specifier) =>
					specifier.startsWith('.') || specifier.startsWith('#app/'),
			),
		)
		expect(aiRoutes.map((route) => route.path)).toEqual(
			expect.arrayContaining([
				'/recipes/import',
				'/resources/enhance-recipe',
				'/resources/transcribe',
			]),
		)
		for (const route of aiRoutes) {
			const tier = postTier(route.path)
			expect({
				route: route.path,
				strict: tier === 'ai' || tier === 'auth',
			}).toEqual({ route: route.path, strict: true })
		}
	})
})

describe('the import scanner the coverage tests rely on', () => {
	test('finds every kind of run-time import, and skips type-only ones', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'qm-scan-'))
		const write = (name: string, body: string) => {
			const file = path.join(dir, name)
			writeFileSync(file, body)
			return file
		}
		write('ai.ts', "import { x } from 'recipe-extract-llm'\nexport { x }\n")
		write('dynamic.ts', "export const run = () => import('./ai')\n")
		write('reexport.ts', 'export { run } from "./dynamic"\n')
		write('deep4.ts', "export * from './reexport.ts'\n")
		write('deep3.ts', "import './deep4'\n")
		write('deep2.ts', "import { a } from './deep3'\n")
		write('deep1.ts', "import a from './deep2'\n")
		const entry = write('entry.tsx', "import { b } from './deep1'\n")
		const typeOnly = write(
			'types.ts',
			"import type { X } from './ai'\nimport { type Y } from './ai'\nexport type { Z } from './ai'\n",
		)
		const follow = (specifier: string) => specifier.startsWith('.')
		expect(reaches(entry, AI_HELPERS, follow)).toBe(true)
		expect(reaches(typeOnly, AI_HELPERS, follow)).toBe(false)
		expect(
			hasAction(
				write('const-action.ts', 'export const action = async () => null\n'),
			),
		).toBe(true)
		expect(
			hasAction(
				write('reexported-action.ts', "export { action } from './x'\n"),
			),
		).toBe(true)
		expect(
			hasAction(write('no-action.ts', 'export const loader = () => null\n')),
		).toBe(false)
	})
})
