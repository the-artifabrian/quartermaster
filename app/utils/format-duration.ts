const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

/**
 * Formats a Recipe time stored in minutes for reading: "45 min",
 * "1 hr 30 min", "19 hr", "1 day 2 hr". Minutes drop once a duration
 * reaches a day. Zero, negative and non-finite values read as "0 min".
 */
export function formatDuration(minutes: number): string {
	const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
	if (total < MINUTES_PER_HOUR) return `${total} min`

	const days = Math.floor(total / MINUTES_PER_DAY)
	const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
	const mins = total % MINUTES_PER_HOUR

	if (days > 0) {
		const dayPart = `${days} ${days === 1 ? 'day' : 'days'}`
		return hours ? `${dayPart} ${hours} hr` : dayPart
	}
	return mins ? `${hours} hr ${mins} min` : `${hours} hr`
}
