/**
 * Resource-timing attribution for a navigation's single-fetch `.data` request.
 *
 * Lets `nav_duration_ms` record WHY a navigation was slow — cold connection vs slow
 * server vs cache miss — in aggregate (a GROUP BY), not just on one session replay:
 *   - transfer_size === 0 ⇒ a service worker / HTTP cache response is likely
 *   - connect_ms > 0      ⇒ a fresh TCP/TLS connection was set up (cold-connection cost)
 *   - ttfb_ms             ⇒ server processing once the request was on the wire
 *   - protocol            ⇒ which HTTP version actually carried it (h3/h2)
 *
 * Kept apart from the React component so the matching/extraction is unit-testable
 * without pulling in posthog/react. Safari zeroes some Resource Timing fields; treat a
 * missing/zero field as "not reported by this device" rather than a measured zero.
 */

/** Resource-timing breakdown of a navigation's `.data` fetch. */
export type DataTiming = {
	transfer_size: number
	body_size: number
	protocol?: string
	dns_ms: number
	connect_ms: number
	tls_ms: number
	ttfb_ms: number
	resource_ms: number
}

// The `.data` resource entry can start a few ms before our effect records navStart
// (RR7 kicks off the fetch before the loading→idle effect runs). Allow a little slack
// so we still match it, but not so much that a previous navigation's fetch matches.
export const DATA_ENTRY_SLACK_MS = 100

/**
 * Find the destination route's single-fetch `.data` request among resource entries.
 *
 * Single-fetch issues one `.data` request per navigation, so the newest entry whose
 * URL carries the `${toPath}.data` marker and that began with this navigation is the
 * one. A nav that skipped revalidation (shouldRevalidate=false) has no fresh entry →
 * null, which is itself the signal that no network happened. Entries are ordered by
 * startTime, so we stop once we fall out of the navigation's time window. The `.data`
 * suffix anchors the match, so `/recipes` does not match `/recipes/<id>.data`.
 */
export function pickDataEntry(
	entries: PerformanceResourceTiming[],
	navStart: number,
	toPath: string,
): PerformanceResourceTiming | null {
	if (!toPath) return null
	const marker = `${toPath}.data`
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!
		if (entry.startTime < navStart - DATA_ENTRY_SLACK_MS) break
		if (entry.name.includes(marker)) return entry
	}
	return null
}

/** Pull the cause-attribution fields out of a `.data` resource entry. */
export function extractDataTiming(
	entry: PerformanceResourceTiming,
): DataTiming {
	const round = (n: number) => Math.round(n)
	return {
		// 0 usually means the SW / HTTP cache supplied the response (no transfer).
		transfer_size: entry.transferSize,
		body_size: entry.encodedBodySize,
		protocol: entry.nextHopProtocol || undefined,
		dns_ms: round(entry.domainLookupEnd - entry.domainLookupStart),
		// > 0 ⇒ a fresh TCP/TLS connection was established (the cold-connection signal);
		// 0 ⇒ an existing connection was reused.
		connect_ms:
			entry.connectEnd > entry.connectStart
				? round(entry.connectEnd - entry.connectStart)
				: 0,
		tls_ms:
			entry.secureConnectionStart > 0
				? round(entry.connectEnd - entry.secureConnectionStart)
				: 0,
		ttfb_ms: round(entry.responseStart - entry.requestStart),
		resource_ms: round(entry.duration),
	}
}

/**
 * Read the `.data` resource timing for a just-completed navigation, or null if the
 * Resource Timing API is unavailable or no matching entry exists (e.g. the nav was
 * served entirely client-side with no revalidation).
 */
export function readDataTiming(
	navStart: number,
	toPath: string,
): DataTiming | null {
	if (
		typeof performance === 'undefined' ||
		typeof performance.getEntriesByType !== 'function'
	) {
		return null
	}
	const entries = performance.getEntriesByType(
		'resource',
	) as PerformanceResourceTiming[]
	const entry = pickDataEntry(entries, navStart, toPath)
	return entry ? extractDataTiming(entry) : null
}
