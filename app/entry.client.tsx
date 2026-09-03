import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { PostHogProvider } from '#app/utils/posthog-provider.tsx'

startTransition(() => {
	hydrateRoot(
		document,
		<PostHogProvider>
			<HydratedRouter />
		</PostHogProvider>,
	)
})
