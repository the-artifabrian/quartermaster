import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { PostHogProvider } from '#app/utils/posthog-provider.tsx'
import {
	listenForShellRefresh,
	reportLaunchPainted,
} from '#app/utils/shell-bridge.ts'

// Before hydration, so the iOS app's pull to refresh is answered even then.
listenForShellRefresh()
// The iOS app lifts its cold-start picture once a frame of this page is up,
// which needs no hydration either.
reportLaunchPainted()

startTransition(() => {
	hydrateRoot(
		document,
		<PostHogProvider>
			<HydratedRouter />
		</PostHogProvider>,
	)
})
