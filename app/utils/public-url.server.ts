import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * Server-side fetches of user-supplied URLs (Recipe import) must never reach
 * this machine, the Fly private network, or cloud metadata. A URL counts as
 * public only when it is http(s) and every address its host resolves to lies
 * outside the private and reserved ranges below. `fetchPublicUrl` connects to
 * one of the addresses it checked, so a DNS answer that changes after the
 * check (rebinding) cannot move the request.
 */

export type ResolveHost = (
	hostname: string,
) => Promise<Array<{ address: string }>>

const nonPublic = new BlockList()
for (const [network, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
] as const) {
	nonPublic.addSubnet(network, prefix, 'ipv4')
}
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked against the IPv4
// rules above. A ::ffff:0:0/96 rule would instead match every IPv4 address.
for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
] as const) {
	nonPublic.addSubnet(network, prefix, 'ipv6')
}

// NAT64 (DNS64) addresses carry the IPv4 destination in their last 32 bits.
const nat64 = new BlockList()
nat64.addSubnet('64:ff9b::', 96, 'ipv6')

function embeddedIPv4(address: string) {
	const [high = '', low = ''] = address.split(':').slice(-2)
	if (low.includes('.')) return low
	const [hi, lo] = [parseInt(high || '0', 16), parseInt(low || '0', 16)]
	return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
}

const INTERNAL_NAME = /(^|\.)(localhost|local|internal)$/

const resolveWithDns: ResolveHost = (hostname) =>
	lookup(hostname, { all: true, verbatim: true })

function isPublicAddress(address: string) {
	const family = isIP(address)
	if (family === 0) return false
	if (family === 6 && nat64.check(address, 'ipv6')) {
		return isPublicAddress(embeddedIPv4(address))
	}
	return !nonPublic.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

type CheckedUrl = {
	url: URL
	/** The host without IPv6 brackets or a trailing dot. */
	hostname: string
	/** Every address the host resolved to. All of them are public. */
	addresses: Array<string>
}

/** Resolves the host once. Returns null unless the URL is public. */
async function checkUrl(
	url: string | URL,
	resolveHost: ResolveHost,
): Promise<CheckedUrl | null> {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

	// URL keeps brackets on IPv6 literals and already normalizes other IPv4
	// spellings (2130706433, 0x7f.1) to dotted decimal.
	const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
	if (isIP(hostname)) {
		return isPublicAddress(hostname)
			? { url: parsed, hostname, addresses: [hostname] }
			: null
	}
	if (!hostname.includes('.') || INTERNAL_NAME.test(hostname)) return null

	try {
		const addresses = (await resolveHost(hostname)).map(
			({ address }) => address,
		)
		if (addresses.length === 0 || !addresses.every(isPublicAddress)) return null
		return { url: parsed, hostname, addresses }
	} catch {
		return null
	}
}

export async function isPublicUrl(
	url: string | URL,
	resolveHost: ResolveHost = resolveWithDns,
): Promise<boolean> {
	return (await checkUrl(url, resolveHost)) !== null
}

// Bun's fetch extension, which the DOM RequestInit type does not declare.
type BunRequestInit = RequestInit & { tls?: { serverName?: string } }

/**
 * Requests the URL from one address. Bun's fetch has no DNS hook, so the URL
 * names the address itself, and the Host header and `tls.serverName` carry
 * the original name. Bun sends serverName as SNI and verifies the certificate
 * against it. Bun also keys its keep-alive pool by serverName but not by Host,
 * so this keeps a socket verified for one name from serving another name at
 * the same address.
 */
function fetchFrom(target: CheckedUrl, address: string, init: RequestInit) {
	if (address === target.hostname) return fetch(target.url, init)

	const url = new URL(target.url)
	url.hostname = isIP(address) === 6 ? `[${address}]` : address
	const headers = new Headers(init.headers)
	headers.set('Host', target.url.host)
	const pinned: BunRequestInit = {
		...init,
		headers,
		tls: { serverName: target.hostname },
	}
	return fetch(url, pinned)
}

/**
 * Tries the checked addresses in turn, IPv4 first because not every network
 * routes IPv6, and never any address the check did not see.
 */
async function fetchChecked(target: CheckedUrl, init: RequestInit) {
	const addresses = [...target.addresses].sort((a, b) => isIP(a) - isIP(b))
	let failure: unknown
	for (const address of addresses) {
		try {
			const response = await fetchFrom(target, address, init)
			// Report the URL that was asked for, not the address that served it,
			// so relative links resolve against the name.
			const url = new URL(target.url)
			url.hash = ''
			Object.defineProperty(response, 'url', { value: url.href })
			return response
		} catch (error) {
			failure = error
		}
	}
	throw failure
}

/**
 * Fetches a user-supplied URL, checking every redirect hop before requesting
 * it and connecting only to an address the check approved. Returns null when
 * any hop is not public or the redirects do not end.
 */
export async function fetchPublicUrl(
	url: string,
	init: Omit<RequestInit, 'redirect'>,
	{
		resolveHost = resolveWithDns,
		maxRedirects = 5,
	}: { resolveHost?: ResolveHost; maxRedirects?: number } = {},
): Promise<Response | null> {
	let current = url
	for (let hop = 0; hop <= maxRedirects; hop++) {
		const target = await checkUrl(current, resolveHost)
		if (!target) return null
		const response = await fetchChecked(target, { ...init, redirect: 'manual' })
		const location = response.headers.get('location')
		if (response.status < 300 || response.status >= 400 || !location) {
			return response
		}
		await response.body?.cancel()
		current = new URL(location, current).href
	}
	return null
}
