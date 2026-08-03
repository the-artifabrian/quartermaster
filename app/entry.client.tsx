import { PostHogProvider } from '@posthog/react'
import posthog from 'posthog-js'
import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

// window.ENV is set by root.tsx <script> tag before <Scripts> loads
const posthogKey = window.ENV.POSTHOG_API_KEY
if (posthogKey) {
	posthog.init(posthogKey, {
		api_host: window.ENV.POSTHOG_HOST || 'https://eu.i.posthog.com',
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

startTransition(() => {
	hydrateRoot(
		document,
		posthogKey ? (
			<PostHogProvider client={posthog}>
				<HydratedRouter />
			</PostHogProvider>
		) : (
			<HydratedRouter />
		),
	)
})

if ('serviceWorker' in navigator && ENV.MODE === 'production') {
	window.addEventListener('load', () => {
		void navigator.serviceWorker.register('/sw.js')
	})
}
