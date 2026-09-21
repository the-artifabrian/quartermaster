import closeWithGrace from 'close-with-grace'
import { setupServer } from 'msw/node'
import { isLocalHostname } from '../setup/network-guard.ts'
import { handlers as anthropicHandlers } from './anthropic.ts'
import { handlers as googleHandlers } from './google.ts'
import { handlers as pwnedPasswordApiHandlers } from './pwned-passwords.ts'
import { handlers as resendHandlers } from './resend.ts'
import { handlers as stripeHandlers } from './stripe.ts'
import { handlers as tigrisHandlers } from './tigris.ts'

export const server = setupServer(
	...resendHandlers,
	...googleHandlers,
	...tigrisHandlers,
	...pwnedPasswordApiHandlers,
	...stripeHandlers,
	...anthropicHandlers,
)

server.listen({
	onUnhandledRequest(request, print) {
		if (request.url.includes('posthog.com')) {
			return
		}
		// React-router-devtools send custom requests internally to handle some functionality, we ignore those
		if (request.url.includes('__rrdt')) {
			return
		}
		// Tests that spin up a real local server (e.g. the SSE/compression
		// harness) talk to themselves — nothing to mock.
		if (isLocalHostname(new URL(request.url).hostname)) {
			return
		}
		// Print the regular MSW unhandled request warning otherwise.
		print.warning()
	},
})

if (process.env.NODE_ENV !== 'test') {
	console.info('🔶 Mock server installed')

	closeWithGrace(() => {
		server.close()
	})
}
