import { remember } from '@epic-web/remember'
import { PostHog } from 'posthog-node'
import { getPostHogHost } from './posthog-config.ts'

// Shutdown runs inside server/shutdown.ts's 4s grace period and the memory
// watchdog's fatal path. PostHog defaults to 30s, which would outlive both.
const POSTHOG_SHUTDOWN_TIMEOUT_MS = 3_000

function createPostHogClient(): PostHog | null {
	const apiKey = process.env.POSTHOG_API_KEY
	if (!apiKey) return null

	return new PostHog(apiKey, {
		host: getPostHogHost(process.env.POSTHOG_HOST),
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
		await client.shutdown(POSTHOG_SHUTDOWN_TIMEOUT_MS)
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
