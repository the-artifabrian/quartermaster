import { describe, expect, test } from 'vitest'
import {
	DATA_ENTRY_SLACK_MS,
	extractDataTiming,
	pickDataEntry,
} from './nav-resource-timing.ts'

/** Build a fake resource entry; only the fields the code reads need to be set. */
function entry(
	name: string,
	startTime: number,
	fields: Partial<PerformanceResourceTiming> = {},
): PerformanceResourceTiming {
	return {
		name,
		startTime,
		duration: 0,
		transferSize: 0,
		encodedBodySize: 0,
		decodedBodySize: 0,
		nextHopProtocol: '',
		domainLookupStart: 0,
		domainLookupEnd: 0,
		connectStart: 0,
		connectEnd: 0,
		secureConnectionStart: 0,
		requestStart: 0,
		responseStart: 0,
		responseEnd: 0,
		...fields,
	} as unknown as PerformanceResourceTiming
}

describe('pickDataEntry', () => {
	const navStart = 1000

	test('matches the destination route .data request that began with this nav', () => {
		const e = entry('https://app/recipes.data', navStart + 2)
		expect(pickDataEntry([e], navStart, '/recipes')).toBe(e)
	})

	test('matches even with the single-fetch ?_routes query string appended', () => {
		const e = entry('https://app/recipes.data?_routes=root', navStart + 1)
		expect(pickDataEntry([e], navStart, '/recipes')).toBe(e)
	})

	test('picks the newest matching entry when several are in the window', () => {
		const older = entry('https://app/recipes.data', navStart - 40)
		const other = entry('https://app/shopping.data', navStart + 5)
		const newest = entry('https://app/recipes.data', navStart + 10)
		expect(pickDataEntry([older, other, newest], navStart, '/recipes')).toBe(
			newest,
		)
	})

	test('ignores a stale .data entry from a previous navigation', () => {
		const stale = entry(
			'https://app/recipes.data',
			navStart - DATA_ENTRY_SLACK_MS - 1,
		)
		expect(pickDataEntry([stale], navStart, '/recipes')).toBeNull()
	})

	test('anchors on .data so /recipes does not match /recipes/<id>.data', () => {
		const detail = entry('https://app/recipes/abc123.data', navStart + 1)
		expect(pickDataEntry([detail], navStart, '/recipes')).toBeNull()
		expect(pickDataEntry([detail], navStart, '/recipes/abc123')).toBe(detail)
	})

	test('returns null for an empty destination path (no marker to match)', () => {
		const e = entry('https://app/recipes.data', navStart + 1)
		expect(pickDataEntry([e], navStart, '')).toBeNull()
	})
})

describe('extractDataTiming', () => {
	test('flags a service-worker / cache hit as zero bytes off the wire', () => {
		// SW served from cache: no new connection, no transfer.
		const hit = entry('https://app/recipes.data', 0, {
			transferSize: 0,
			connectStart: 5,
			connectEnd: 5, // reused connection: connectEnd not > connectStart
			requestStart: 10,
			responseStart: 12,
			duration: 8,
		})
		const t = extractDataTiming(hit)
		expect(t.transfer_size).toBe(0)
		expect(t.connect_ms).toBe(0)
		expect(t.tls_ms).toBe(0)
		expect(t.ttfb_ms).toBe(2)
		expect(t.resource_ms).toBe(8)
		expect(t.protocol).toBeUndefined()
	})

	test('surfaces a cold connection: fresh TCP/TLS setup dominates the time', () => {
		const cold = entry('https://app/recipes.data', 0, {
			transferSize: 4096,
			encodedBodySize: 3500,
			nextHopProtocol: 'h3',
			domainLookupStart: 10,
			domainLookupEnd: 25,
			connectStart: 25,
			connectEnd: 120,
			secureConnectionStart: 60,
			requestStart: 120,
			responseStart: 1900,
			duration: 2000,
		})
		const t = extractDataTiming(cold)
		expect(t.transfer_size).toBe(4096)
		expect(t.body_size).toBe(3500)
		expect(t.protocol).toBe('h3')
		expect(t.dns_ms).toBe(15)
		expect(t.connect_ms).toBe(95) // > 0 ⇒ cold connection
		expect(t.tls_ms).toBe(60)
		expect(t.ttfb_ms).toBe(1780)
		expect(t.resource_ms).toBe(2000)
	})
})
