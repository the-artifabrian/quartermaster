import posthog from 'posthog-js'
import { type AnalyticsClient } from './posthog-provider.tsx'

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
				return event
			},
			// Built-in performance capture: Core Web Vitals (incl. INP) as standalone
			// events, plus resource/network timing attached to session replay — gives
			// the `.data` fetch TTFB/download split without custom instrumentation.
			capture_performance: { web_vitals: true, network_timing: true },
		})
	}

	return {
		capture: (event, properties) => {
			posthog.capture(event, properties)
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
		reset: () => {
			posthog.reset()
		},
		getFeatureFlag: (key) => posthog.getFeatureFlag(key),
	}
}
