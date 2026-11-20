import crypto from 'node:crypto'
import { isIP } from 'node:net'
import { ipKeyGenerator } from 'express-rate-limit'

/**
 * The header a Cloudflare Transform Rule sets on every request to our zone,
 * with the value of CF_EDGE_SECRET. The rule overwrites any value the client
 * sent, so only requests that came through our zone carry the right one.
 * The connecting address alone can't show that.
 */
export const EDGE_SECRET_HEADER = 'x-qm-edge'

/**
 * The one bucket for requests whose proxy address can't be read. Fly always
 * sets fly-client-ip to a single address, so this should stay empty.
 */
export const UNKNOWN_CLIENT_KEY = 'unknown-client'

function sha256(value: string) {
	return crypto.createHash('sha256').update(value).digest()
}

function isFromOurEdge(sent: string | undefined, secret: string | undefined) {
	if (!secret || !sent) return false
	// Digests have equal length, which timingSafeEqual needs.
	return crypto.timingSafeEqual(sha256(sent), sha256(secret))
}

/**
 * The address itself when the value is exactly one IP address. IPv4-mapped
 * IPv6 addresses, in dotted or hex form, become the IPv4 address. Anything
 * else, including an address with a zone id, is null.
 */
function asAddress(value: string | undefined | null): string | null {
	const trimmed = value?.trim()
	if (!trimmed) return null
	const family = isIP(trimmed)
	if (family === 4) return trimmed
	if (family !== 6) return null
	let normal: string
	try {
		// The URL parser writes every IPv6 address in one compressed form, so
		// ::ffff:1.2.3.4, ::ffff:102:304 and 0:0:0:0:0:ffff:102:304 all match.
		normal = new URL(`http://[${trimmed}]`).hostname.slice(1, -1)
	} catch {
		return null
	}
	const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normal)
	if (!mapped) return normal
	const high = parseInt(mapped[1]!, 16)
	const low = parseInt(mapped[2]!, 16)
	return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

function keyFor(address: string) {
	// One IPv6 visitor usually holds a whole /64.
	return ipKeyGenerator(address, 64)
}

/**
 * The client address a rate limit counts against. Production runs behind
 * Cloudflare, then Fly. Fly sets fly-client-ip to whoever connected to it,
 * which is a Cloudflare edge for normal traffic. The visitor's own address
 * is then in cf-connecting-ip, which counts only when the request carries
 * our edge secret. Without it (secret unset, header missing or wrong) the
 * key is fly-client-ip.
 *
 * req.ip is used only when no fly-client-ip arrives at all, as in local
 * runs. With `trust proxy` on it comes from X-Forwarded-For, which the
 * client writes, so a fly-client-ip that is present but unreadable goes to
 * one shared bucket instead.
 */
export function clientAddressKey({
	flyClientIp,
	cfConnectingIp,
	edgeSecret,
	ip,
	expectedEdgeSecret = process.env.CF_EDGE_SECRET,
	onEdgeMismatch,
}: {
	flyClientIp?: string | null
	cfConnectingIp?: string | null
	/** The x-qm-edge header as received. */
	edgeSecret?: string | null
	ip?: string | null
	expectedEdgeSecret?: string
	/**
	 * Called for a request that came through Cloudflare (both proxy headers)
	 * without the secret we expect, while one is set. Its key then falls back
	 * to fly-client-ip.
	 */
	onEdgeMismatch?: () => void
}): string {
	if (flyClientIp != null) {
		const fly = asAddress(flyClientIp)
		if (!fly) return UNKNOWN_CLIENT_KEY
		const fromEdge = isFromOurEdge(edgeSecret ?? undefined, expectedEdgeSecret)
		if (!fromEdge && expectedEdgeSecret && cfConnectingIp) onEdgeMismatch?.()
		const visitor = fromEdge ? asAddress(cfConnectingIp) : null
		return keyFor(visitor ?? fly)
	}
	const local = asAddress(ip)
	return local ? keyFor(local) : UNKNOWN_CLIENT_KEY
}

/**
 * Warns once at boot when production runs without the edge secret, since
 * every visitor behind one Cloudflare edge then shares a bucket.
 */
export function warnIfEdgeSecretMissing({
	isProduction,
	secret = process.env.CF_EDGE_SECRET,
	warn = console.warn,
}: {
	isProduction: boolean
	secret?: string
	warn?: (message: string) => void
}) {
	if (isProduction && !secret) {
		warn(
			'CF_EDGE_SECRET is not set: rate limits count Cloudflare edge addresses, not visitors (docs/ARCHITECTURE.md, Deployment and recovery).',
		)
	}
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Counts requests that came through Cloudflare without a matching edge
 * secret, and warns about them at most once an hour: at the first one, then
 * at the first one an hour or more after the last warning, with the count
 * since then. Counts that come after the last warning wait for the next
 * mismatch. The header's value is never logged.
 */
export function edgeMismatchWarning({
	now = Date.now,
	warn = console.warn,
}: {
	now?: () => number
	warn?: (message: string) => void
} = {}) {
	let count = 0
	let warnedAt: number | null = null
	return () => {
		count++
		const time = now()
		if (warnedAt !== null && time - warnedAt < HOUR_MS) return
		warn(
			`${count} ${count === 1 ? 'request' : 'requests'} came through Cloudflare without a matching ${EDGE_SECRET_HEADER} header${warnedAt === null ? '' : ' since the last warning'}, so rate limits counted the Cloudflare edge's address for them. Check that the Transform Rule and CF_EDGE_SECRET still match (docs/ARCHITECTURE.md, Deployment and recovery).`,
		)
		count = 0
		warnedAt = time
	}
}
