/**
 * Optional Meal serving time (#98 readiness corrections): stored once as a UTC
 * instant plus the IANA timezone it was entered in. Time edits recompute the
 * instant from the Plan's semantic date; Release 5 reuses this representation.
 *
 * Isomorphic on purpose — the server computes instants from submitted wall
 * times, components format stored instants back into their originating zone.
 * Uses Intl instead of a timezone library: the two-pass offset probe below is
 * exact for real IANA zones (offsets change at most once around any instant).
 */

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone })
		return true
	} catch {
		return false
	}
}

/** The UTC epoch ms that `timeZone`'s wall clock would show at `date`. */
function wallTimeAsUtcMs(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(date)
	const get = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value)
	return Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		// 'h23' can still emit "24" at midnight in some ICU versions
		get('hour') % 24,
		get('minute'),
		get('second'),
	)
}

/**
 * Convert a wall-clock time on the Meal's semantic day (a UTC-midnight date)
 * in an IANA timezone into the UTC instant it names. Nonexistent wall times
 * during a DST spring-forward gap resolve to the shifted instant the zone
 * actually observes.
 */
export function servingInstantFromWallTime(
	semanticDate: Date,
	time: string, // "HH:MM"
	timeZone: string,
): Date {
	const [hours = 0, minutes = 0] = time.split(':').map(Number)
	const wallAsUtc = Date.UTC(
		semanticDate.getUTCFullYear(),
		semanticDate.getUTCMonth(),
		semanticDate.getUTCDate(),
		hours,
		minutes,
	)
	// First pass with the offset at the naive instant, second pass in case that
	// guess crossed a DST transition.
	const offset1 = wallTimeAsUtcMs(new Date(wallAsUtc), timeZone) - wallAsUtc
	const guess = wallAsUtc - offset1
	const offset2 = wallTimeAsUtcMs(new Date(guess), timeZone) - guess
	return new Date(wallAsUtc - offset2)
}

/** "HH:MM" that the stored instant shows on its originating zone's clock. */
export function servingWallTime(servingAt: Date, timeZone: string): string {
	const wall = new Date(wallTimeAsUtcMs(servingAt, timeZone))
	return `${String(wall.getUTCHours()).padStart(2, '0')}:${String(
		wall.getUTCMinutes(),
	).padStart(2, '0')}`
}

/** Display form like "6:30 PM", rendered in the instant's originating zone. */
export function formatServingTime(servingAt: Date, timeZone: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: 'numeric',
		minute: '2-digit',
	}).format(servingAt)
}
