export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'

export function getPostHogHost(host?: string) {
	return host || DEFAULT_POSTHOG_HOST
}

/** PostHog Cloud loads browser extensions from a sibling assets host. */
export function getPostHogAssetHost(host?: string) {
	const url = new URL(getPostHogHost(host))
	const cloudHost = url.hostname.match(/^([^.]+)\.i\.posthog\.com$/)
	if (cloudHost) url.hostname = `${cloudHost[1]}-assets.i.posthog.com`
	return url.origin
}
