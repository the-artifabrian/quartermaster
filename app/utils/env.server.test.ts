import { expect, test } from 'vitest'
import { getEnv } from './env.server.ts'

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
	using _commit = withCommitSha(undefined)
	expect(getEnv().APP_BUILD).toBe('unknown')
})
