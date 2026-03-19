import { remember } from '@epic-web/remember'
import { PostHog } from 'posthog-node'

function createPostHogClient(): PostHog | null {
	const apiKey = process.env.POSTHOG_API_KEY
	if (!apiKey) return null

	return new PostHog(apiKey, {
		host: process.env.POSTHOG_HOST || 'https://eu.i.posthog.com',
		flushAt: 20,
		flushInterval: 10000,
	})
}

export function getPostHogClient(): PostHog | null {
	return remember('posthog', createPostHogClient)
}

export async function shutdownPostHog(): Promise<void> {
	const client = getPostHogClient()
	if (client) {
		await client.shutdown()
	}
}

export function captureServerEvent(
	userId: string,
	event: string,
	properties?: Record<string, unknown>,
): void {
	const client = getPostHogClient()
	if (!client) return

	client.capture({
		distinctId: userId,
		event,
		properties,
	})
}

const FLAG_TIMEOUT_MS = 1500

export async function getFeatureFlag(
	userId: string,
	flagKey: string,
): Promise<string | boolean | undefined> {
	const client = getPostHogClient()
	if (!client) return undefined

	return Promise.race([
		client.getFeatureFlag(flagKey, userId),
		new Promise<undefined>((resolve) =>
			setTimeout(() => resolve(undefined), FLAG_TIMEOUT_MS),
		),
	])
}

export async function getFeatureFlags(
	userId: string,
): Promise<Record<string, string | boolean> | undefined> {
	const client = getPostHogClient()
	if (!client) return undefined

	return Promise.race([
		client.getAllFlags(userId) as Promise<Record<string, string | boolean>>,
		new Promise<undefined>((resolve) =>
			setTimeout(() => resolve(undefined), FLAG_TIMEOUT_MS),
		),
	])
}
