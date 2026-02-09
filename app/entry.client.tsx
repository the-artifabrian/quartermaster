import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

if (ENV.MODE === 'production' && ENV.SENTRY_DSN) {
	void import('./utils/monitoring.client.tsx').then(({ init }) => init())
}

startTransition(() => {
	hydrateRoot(document, <HydratedRouter />)
})

if ('serviceWorker' in navigator && ENV.MODE === 'production') {
	window.addEventListener('load', () => {
		void navigator.serviceWorker.register('/sw.js')
	})
}
