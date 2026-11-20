import posthog from 'posthog-js'
import { type AnalyticsClient } from './posthog-provider.tsx'
import { redactUrl } from './redact-url.ts'

const looksLikeUrl = /^(?:https?:\/\/|\/)/

// Autocapture describes a clicked link in one string, with its address in
// href="..." and attr__href="...".
const hrefInChain = /((?:attr__)?href=")((?:[^"\\]|\\.)*)"/g

// URLs inside free text, such as an error message: absolute ones, and paths
// that carry a query string.
const urlInText = /https?:\/\/[^\s"'<>`]+|\/[^\s"'<>`?]*\?[^\s"'<>`]+/g

// Deep enough for the URL inside a web vitals metric
// (properties.$web_vitals_LCP_event.$current_url), its attribution, and
// autocapture's $elements list.
const MAX_DEPTH = 4

function redactUrlsInText(text: string) {
	return text.replace(urlInText, (url) => redactUrl(url))
}

function redactUrlsIn(
	values: Record<string, unknown> | unknown[],
	depth: number,
) {
	for (const [name, value] of Object.entries(values)) {
		const set = (next: unknown) => {
			;(values as Record<string, unknown>)[name] = next
		}
		if (typeof value === 'string') {
			if (name === '$elements_chain') {
				set(
					value.replace(
						hrefInChain,
						(_, start: string, href: string) => `${start}${redactUrl(href)}"`,
					),
				)
			} else if (name === '$exception_message') {
				set(redactUrlsInText(value))
			} else if (looksLikeUrl.test(value)) {
				set(redactUrl(value))
			}
		} else if (name === '$exception_list' && Array.isArray(value)) {
			for (const exception of value as Array<{ value?: unknown }>) {
				if (typeof exception?.value === 'string') {
					exception.value = redactUrlsInText(exception.value)
				}
			}
			redactUrlsIn(value, depth + 1)
		} else if (name === '$snapshot_data' && Array.isArray(value)) {
			redactSnapshotPages(value)
		} else if (value && typeof value === 'object' && depth < MAX_DEPTH) {
			redactUrlsIn(value as Record<string, unknown> | unknown[], depth + 1)
		}
	}
}

type ReplayEvent = {
	type?: unknown
	data?: { href?: unknown; payload?: { href?: unknown } }
}

/**
 * Replay data is large, so only the page addresses are read: the meta event
 * at the start of each page (type 4, data.href) and the page view marker
 * (type 5, data.payload.href). Page content is not redacted.
 */
function redactSnapshotPages(events: unknown[]) {
	for (const event of events as ReplayEvent[]) {
		const data = event?.data
		if (!data || typeof data !== 'object') continue
		if (event.type === 4 && typeof data.href === 'string') {
			data.href = redactUrl(data.href)
		}
		if (event.type === 5 && typeof data.payload?.href === 'string') {
			data.payload.href = redactUrl(data.payload.href)
		}
	}
}

/**
 * Redacts codes, tokens and email addresses from every URL-valued property
 * ($current_url, $referrer, $initial_current_url, web vitals' own
 * $current_url, the links autocapture records, URLs in error messages and
 * replay page addresses). The verify and invite pages carry them in the
 * query string.
 */
function redactEventUrls<Event extends object>(event: Event): Event {
	for (const key of ['properties', '$set', '$set_once']) {
		const bag = (event as Record<string, unknown>)[key]
		if (bag && typeof bag === 'object') {
			redactUrlsIn(bag as Record<string, unknown>, 0)
		}
	}
	return event
}

export function initializePostHog({
	apiKey,
	host,
}: {
	apiKey: string
	host: string
}): AnalyticsClient {
	if (!posthog.__loaded) {
		posthog.init(apiKey, {
			api_host: host,
			capture_pageview: false,
			capture_pageleave: true,
			person_profiles: 'identified_only',
			persistence: 'localStorage+cookie',
			enable_recording_console_log: true,
			mask_all_text: false,
			capture_exceptions: true,
			// Outlook SafeLinks scanners execute the page in an embedded browser and
			// throw "Object Not Found Matching Id:N, MethodName:update" — pure bot
			// noise (each Id:N gets its own error-tracking issue), so never send it.
			before_send: (event) => {
				if (
					event?.event === '$exception' &&
					JSON.stringify(event.properties ?? {}).includes(
						'Object Not Found Matching Id',
					)
				) {
					return null
				}
				return event ? redactEventUrls(event) : event
			},
			session_recording: {
				maskCapturedNetworkRequestFn: (request) => ({
					...request,
					name: redactUrl(request.name),
				}),
			},
			// Built-in performance capture: Core Web Vitals (incl. INP) as standalone
			// events, plus resource/network timing attached to session replay — gives
			// the `.data` fetch TTFB/download split without custom instrumentation.
			capture_performance: { web_vitals: true, network_timing: true },
		})
	}

	return {
		capture: (event, properties, options) => {
			posthog.capture(event, properties, options)
		},
		captureException: (error) => {
			posthog.captureException(error)
		},
		identify: (userId, properties) => {
			posthog.identify(userId, properties)
		},
		group: (groupType, groupId) => {
			posthog.group(groupType, groupId)
		},
		registerForSession: (properties) => {
			posthog.register_for_session(properties)
		},
		reset: () => {
			posthog.reset()
		},
		getFeatureFlag: (key) => posthog.getFeatureFlag(key),
	}
}
