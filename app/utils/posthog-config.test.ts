import { expect, test } from 'vitest'
import {
	DEFAULT_POSTHOG_HOST,
	getPostHogAssetHost,
	getPostHogHost,
} from './posthog-config.ts'

test('uses matching browser and asset hosts for the default PostHog cloud region', () => {
	expect(getPostHogHost()).toBe(DEFAULT_POSTHOG_HOST)
	expect(getPostHogAssetHost()).toBe('https://eu-assets.i.posthog.com')
})

test('derives the asset host for another PostHog cloud region', () => {
	expect(getPostHogHost('https://us.i.posthog.com')).toBe(
		'https://us.i.posthog.com',
	)
	expect(getPostHogAssetHost('https://us.i.posthog.com')).toBe(
		'https://us-assets.i.posthog.com',
	)
})

test('keeps self-hosted PostHog assets on the configured origin', () => {
	expect(getPostHogAssetHost('https://posthog.example.com/ingest')).toBe(
		'https://posthog.example.com',
	)
	expect(getPostHogAssetHost('http://localhost:8000')).toBe(
		'http://localhost:8000',
	)
})
