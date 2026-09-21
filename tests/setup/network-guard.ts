export const MOCKS_INSTALLED = Symbol.for('quartermaster.tests.mocks-installed')

/**
 * A test that spins up a real local server talks to itself, so neither this
 * guard nor the MSW handlers have anything to say about it.
 * `URL.hostname` keeps the brackets on IPv6 literals ('[::1]').
 */
export function isLocalHostname(hostname: string) {
	return (
		hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
	)
}

function requestUrl(input: RequestInfo | URL) {
	const raw =
		input instanceof Request
			? input.url
			: input instanceof URL
				? input.href
				: String(input)
	try {
		return new URL(raw)
	} catch {
		return null
	}
}

/**
 * Tests that install the MSW handlers are policed by MSW's own unhandled
 * request warning. For every other test file this stands in for it: an
 * outbound request fails loudly instead of reaching the real network.
 */
export function installNetworkGuard() {
	const actualFetch = globalThis.fetch
	globalThis.fetch = function guardedFetch(input, init) {
		if (!Reflect.get(globalThis, MOCKS_INSTALLED)) {
			const url = requestUrl(input)
			if (url && !isLocalHostname(url.hostname)) {
				return Promise.reject(
					new Error(
						`Unmocked request to ${url.origin}${url.pathname}. Add \`import '#tests/setup/mocks-setup.ts'\` to this test file to install the MSW handlers.`,
					),
				)
			}
		}
		return actualFetch(input, init)
	}
}
