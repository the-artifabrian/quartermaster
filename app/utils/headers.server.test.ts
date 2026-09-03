import { format, parse } from '@tusbar/cache-control'
import { expect, test } from 'vitest'
import {
	getConservativeCacheControl,
	PRIVATE_ALWAYS_REVALIDATE,
	setDefaultDynamicCacheControl,
} from './headers.server.ts'

test('dynamic responses default to private always-revalidate caching', () => {
	const headers = new Headers()
	setDefaultDynamicCacheControl(headers)

	expect(headers.get('Cache-Control')).toBe(PRIVATE_ALWAYS_REVALIDATE)
})

test('an explicit cache policy is preserved', () => {
	const headers = new Headers({ 'Cache-Control': 'public, max-age=300' })
	setDefaultDynamicCacheControl(headers)

	expect(headers.get('Cache-Control')).toBe('public, max-age=300')
})

test('works for basic usecase', () => {
	const result = getConservativeCacheControl(
		'max-age=3600',
		'max-age=1800, s-maxage=600',
		'private, max-age=86400',
	)

	expect(result).toEqual(
		format({
			maxAge: 1800,
			sharedMaxAge: 600,
			private: true,
		}),
	)
})
test('retains boolean directive', () => {
	const result = parse(
		getConservativeCacheControl('private', 'no-cache,no-store'),
	)

	expect(result.private).toBe(true)
	expect(result.noCache).toBe(true)
	expect(result.noStore).toBe(true)
})
test('gets smallest number directive', () => {
	const result = parse(
		getConservativeCacheControl(
			'max-age=10, s-maxage=300',
			'max-age=300, s-maxage=600',
		),
	)

	expect(result.maxAge).toBe(10)
	expect(result.sharedMaxAge).toBe(300)
})
