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
