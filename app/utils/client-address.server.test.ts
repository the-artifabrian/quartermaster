import { describe, expect, test, vi } from 'vitest'
import {
	UNKNOWN_CLIENT_KEY,
	clientAddressKey,
	edgeMismatchWarning,
	warnIfEdgeSecretMissing,
} from './client-address.server.ts'

// Production is Cloudflare, then Fly. Fly sets fly-client-ip to the address
// that connected to it, which is a Cloudflare edge for normal traffic. Our
// zone's Transform Rule adds x-qm-edge with the shared secret. Nothing here may
// put unrelated visitors in one bucket, or let a client pick its own bucket.

const SECRET = 'edge-secret-for-tests'
const visitorA = '203.0.113.7'
const visitorB = '198.51.100.23'
const edge = '172.70.1.2'

function key(fields: Parameters<typeof clientAddressKey>[0]) {
	return clientAddressKey({
		expectedEdgeSecret: SECRET,
		appHost: 'app.example',
		...fields,
	})
}

describe('client address key', () => {
	test('with the secret unset, cf-connecting-ip is ignored', () => {
		expect(
			clientAddressKey({
				flyClientIp: edge,
				cfConnectingIp: visitorA,
				edgeSecret: SECRET,
				expectedEdgeSecret: undefined,
			}),
		).toBe(edge)
		expect(
			clientAddressKey({
				flyClientIp: edge,
				cfConnectingIp: visitorA,
				edgeSecret: '',
				expectedEdgeSecret: '',
			}),
		).toBe(edge)
	})

	test.each([
		['missing', undefined],
		['wrong', 'not-the-secret'],
		['a prefix of the secret', SECRET.slice(0, 5)],
		['empty', ''],
	])('with the edge header %s, cf-connecting-ip is ignored', (_, sent) => {
		expect(
			key({ flyClientIp: edge, cfConnectingIp: visitorA, edgeSecret: sent }),
		).toBe(edge)
	})

	test('a client reaching Fly directly with its own headers keeps its address', () => {
		expect(
			key({
				flyClientIp: visitorA,
				cfConnectingIp: visitorB,
				edgeSecret: 'guessed',
			}),
		).toBe(visitorA)
	})

	test('with the right edge header, visitors behind one edge get their own keys', () => {
		const a = key({
			flyClientIp: edge,
			cfConnectingIp: visitorA,
			edgeSecret: SECRET,
		})
		const b = key({
			flyClientIp: edge,
			cfConnectingIp: visitorB,
			edgeSecret: SECRET,
		})
		expect(a).toBe(visitorA)
		expect(b).toBe(visitorB)
	})

	test.each([undefined, '', '203.0.113.7, 198.51.100.23', 'unknown'])(
		'the right edge header with cf-connecting-ip %j keys on fly-client-ip',
		(cfConnectingIp) => {
			expect(
				key({ flyClientIp: edge, cfConnectingIp, edgeSecret: SECRET }),
			).toBe(edge)
		},
	)

	test.each([
		'::ffff:203.0.113.7',
		'::ffff:cb00:7107',
		'0:0:0:0:0:ffff:cb00:7107',
	])('%s keys like 203.0.113.7', (mapped) => {
		expect(key({ flyClientIp: mapped })).toBe(visitorA)
		expect(
			key({ flyClientIp: edge, cfConnectingIp: mapped, edgeSecret: SECRET }),
		).toBe(visitorA)
		expect(key({ ip: mapped })).toBe(visitorA)
	})

	test('IPv6 visitors are grouped by /64 through Cloudflare', () => {
		const viaEdge = (ip: string) =>
			key({ flyClientIp: edge, cfConnectingIp: ip, edgeSecret: SECRET })
		expect(viaEdge('2001:db8:1:2::a')).toBe(viaEdge('2001:db8:1:2:ffff::b'))
		expect(viaEdge('2001:db8:1:2::a')).not.toBe(viaEdge('2001:db8:1:3::a'))
	})

	test('IPv6 visitors are grouped by /64 straight to Fly', () => {
		const direct = (ip: string) => key({ flyClientIp: ip })
		expect(direct('2001:db8:1:2::a')).toBe(direct('2001:db8:1:2:ffff::b'))
		expect(direct('2001:db8:1:2::a')).not.toBe(direct('2001:db8:1:3::a'))
	})

	test('without fly-client-ip the key is req.ip, grouped by /64', () => {
		expect(key({ ip: visitorA })).toBe(visitorA)
		expect(key({ ip: '2001:db8:1:2::a' })).toBe(key({ ip: '2001:db8:1:2::b' }))
	})

	// req.ip comes from X-Forwarded-For, which the client controls.
	test.each(['', 'nonsense', '203.0.113.7, 198.51.100.23', 'fe80::1%eth0'])(
		'a fly-client-ip of %j goes to the shared bucket, not req.ip',
		(flyClientIp) => {
			expect(key({ flyClientIp, ip: visitorB })).toBe(UNKNOWN_CLIENT_KEY)
		},
	)

	test('an address with a zone id anywhere does not throw', () => {
		expect(() =>
			key({
				flyClientIp: edge,
				cfConnectingIp: 'fe80::1%eth0',
				edgeSecret: SECRET,
				ip: 'fe80::1%eth0',
			}),
		).not.toThrow()
		expect(
			key({
				flyClientIp: edge,
				cfConnectingIp: 'fe80::1%eth0',
				edgeSecret: SECRET,
			}),
		).toBe(edge)
		expect(key({ ip: 'fe80::1%eth0' })).toBe(UNKNOWN_CLIENT_KEY)
	})

	test('with nothing usable every request shares one key', () => {
		expect(key({})).toBe(UNKNOWN_CLIENT_KEY)
		expect(key({ ip: 'nonsense' })).toBe(UNKNOWN_CLIENT_KEY)
	})
})

test('production without the edge secret warns once at boot', () => {
	const warn = vi.fn()
	warnIfEdgeSecretMissing({ isProduction: true, secret: undefined, warn })
	warnIfEdgeSecretMissing({ isProduction: true, secret: '', warn })
	expect(warn).toHaveBeenCalledTimes(2)
	expect(String(warn.mock.calls[0]![0])).toContain('CF_EDGE_SECRET')

	warn.mockClear()
	warnIfEdgeSecretMissing({ isProduction: true, secret: SECRET, warn })
	warnIfEdgeSecretMissing({ isProduction: false, secret: undefined, warn })
	expect(warn).not.toHaveBeenCalled()
})

// When the Cloudflare rule and the Fly secret drift apart, every visitor
// quietly falls back to the edge's bucket, so the mismatch is logged.
describe('a secret that stops matching', () => {
	const both = {
		flyClientIp: edge,
		cfConnectingIp: visitorA,
		host: 'app.example',
	}

	test('counts requests through Cloudflare whose edge header is missing or wrong', () => {
		const onEdgeMismatch = vi.fn()
		key({ ...both, onEdgeMismatch })
		key({ ...both, edgeSecret: 'stale-secret', onEdgeMismatch })
		expect(onEdgeMismatch).toHaveBeenCalledTimes(2)
	})

	test('does not count a matching secret, a direct or local request, or an unset secret', () => {
		const onEdgeMismatch = vi.fn()
		key({ ...both, edgeSecret: SECRET, onEdgeMismatch })
		key({ flyClientIp: visitorA, edgeSecret: 'x', onEdgeMismatch })
		key({ cfConnectingIp: visitorA, ip: visitorB, onEdgeMismatch })
		clientAddressKey({ ...both, expectedEdgeSecret: undefined, onEdgeMismatch })
		clientAddressKey({ ...both, expectedEdgeSecret: '', onEdgeMismatch })
		expect(onEdgeMismatch).not.toHaveBeenCalled()
	})

	// Anyone can reach the fly.dev host with both headers and no secret, and that
	// must not raise the alarm.
	test('counts only requests for the app host', () => {
		const onEdgeMismatch = vi.fn()
		for (const host of ['quartermaster.fly.dev', 'other.example', '', null]) {
			key({ ...both, host, onEdgeMismatch })
		}
		expect(onEdgeMismatch).not.toHaveBeenCalled()
		for (const host of ['APP.example', 'app.example:443', 'app.example.']) {
			key({ ...both, host, onEdgeMismatch })
		}
		expect(onEdgeMismatch).toHaveBeenCalledTimes(3)
	})

	test('warns at once, then at most once an hour with the count', () => {
		const hour = 60 * 60 * 1000
		let now = 1_000_000
		const warn = vi.fn()
		const mismatch = edgeMismatchWarning({ now: () => now, warn })

		mismatch()
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]![0])).toMatch(/\b1 request\b/)

		for (let i = 0; i < 4; i++) {
			now += hour / 5
			mismatch()
		}
		expect(warn).toHaveBeenCalledTimes(1)

		now += hour / 5
		mismatch()
		expect(warn).toHaveBeenCalledTimes(2)
		expect(String(warn.mock.calls[1]![0])).toMatch(/\b5 requests\b/)

		now += hour - 1
		mismatch()
		expect(warn).toHaveBeenCalledTimes(2)
	})

	test('the warning names the header but never its value', () => {
		const warn = vi.fn()
		const mismatch = edgeMismatchWarning({ now: () => 0, warn })
		key({ ...both, edgeSecret: 'stale-secret', onEdgeMismatch: mismatch })
		const message = String(warn.mock.calls[0]![0])
		expect(message).toContain('x-qm-edge')
		expect(message).not.toContain('stale-secret')
		expect(message).not.toContain(SECRET)
	})
})
