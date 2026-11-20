import { expect, test } from 'vitest'
import { z } from 'zod'
import { getEnv, parseEnv } from './env.server.ts'

// Failure list for APP_ORIGIN, the origin every absolute URL is built from:
// 1. Missing in production: the deploy must fail rather than build links from
//    the request.
// 2. Present but empty in production (an emptied secret) fails the same way.
// 3. MOCKS=true does not exempt production (Playwright runs production mode).
// 4. A value that is not a bare origin (trailing slash, path, other scheme)
//    fails: it would produce links like https://host//verify.
// 5. A valid production env with it set passes (so the failures above are
//    about APP_ORIGIN and not some other variable).
// 6. Outside production it stays optional.

function withCommitSha(commitSha: string | undefined) {
	const original = process.env.COMMIT_SHA
	if (commitSha) process.env.COMMIT_SHA = commitSha
	else delete process.env.COMMIT_SHA
	return {
		[Symbol.dispose]() {
			if (original) process.env.COMMIT_SHA = original
			else delete process.env.COMMIT_SHA
		},
	}
}

test('exposes the existing container commit as a compact build id', () => {
	using _commit = withCommitSha('abc123def4567890abc123def4567890abc123de')
	expect(getEnv().APP_BUILD).toBe('abc123def456')
})

test('uses one low-cardinality fallback outside a stamped build', () => {
	using _commit = withCommitSha('   ')
	expect(getEnv().APP_BUILD).toBe('unknown')
})

const productionEnv = {
	NODE_ENV: 'production',
	DATABASE_PATH: '/data/sqlite.db',
	DATABASE_URL: 'file:/data/sqlite.db',
	SESSION_SECRET: 'secret',
	INTERNAL_COMMAND_TOKEN: 'token',
	RESEND_API_KEY: 're_key',
	AWS_ACCESS_KEY_ID: 'id',
	AWS_SECRET_ACCESS_KEY: 'secret',
	AWS_REGION: 'auto',
	AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
	BUCKET_NAME: 'bucket',
	APP_ORIGIN: 'https://app.example',
}

function appOriginErrors(env: Record<string, string | undefined>) {
	const parsed = parseEnv(env)
	if (parsed.success) return null
	return z.flattenError(parsed.error).fieldErrors
}

test('a production env with APP_ORIGIN set passes validation', () => {
	expect(appOriginErrors(productionEnv)).toBeNull()
})

test('production without APP_ORIGIN fails validation on APP_ORIGIN', () => {
	const { APP_ORIGIN: _, ...env } = productionEnv
	expect(Object.keys(appOriginErrors(env) ?? {})).toEqual(['APP_ORIGIN'])
})

test('production with an empty APP_ORIGIN fails validation on APP_ORIGIN', () => {
	expect(
		Object.keys(appOriginErrors({ ...productionEnv, APP_ORIGIN: '' }) ?? {}),
	).toEqual(['APP_ORIGIN'])
})

test('MOCKS=true does not exempt production from APP_ORIGIN', () => {
	const { APP_ORIGIN: _, ...env } = productionEnv
	expect(Object.keys(appOriginErrors({ ...env, MOCKS: 'true' }) ?? {})).toEqual(
		['APP_ORIGIN'],
	)
})

test.each([
	'https://app.example/',
	'https://app.example/app',
	'https://app.example?x=1',
	'ftp://app.example',
	'app.example',
])('APP_ORIGIN %s is not a bare origin and fails validation', (value) => {
	expect(
		Object.keys(appOriginErrors({ ...productionEnv, APP_ORIGIN: value }) ?? {}),
	).toEqual(['APP_ORIGIN'])
})

test('outside production APP_ORIGIN is optional', () => {
	const { APP_ORIGIN: _, ...env } = productionEnv
	expect(appOriginErrors({ ...env, NODE_ENV: 'development' })).toBeNull()
})

test('production boots without CF_EDGE_SECRET, unset or emptied', () => {
	expect(
		appOriginErrors({ ...productionEnv, CF_EDGE_SECRET: undefined }),
	).toBeNull()
	expect(appOriginErrors({ ...productionEnv, CF_EDGE_SECRET: '' })).toBeNull()
	const parsed = parseEnv({ ...productionEnv, CF_EDGE_SECRET: '' })
	expect(parsed.success && parsed.data.CF_EDGE_SECRET).toBeUndefined()
})
