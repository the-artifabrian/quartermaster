import { formatDuration } from '#app/utils/format-duration.ts'

/**
 * Restates a minutes input in hours and days once it reaches an hour, so
 * "1140" reads as "= 19 hr" while the input keeps submitting minutes.
 */
export function DurationHint({ minutes }: { minutes: unknown }) {
	// Conform types field values as unknown; the input holds a string.
	const value =
		typeof minutes === 'string' && minutes.trim() ? Number(minutes) : Number.NaN
	if (!Number.isFinite(value) || value < 60) return null
	return (
		<p className="text-muted-foreground mt-1 text-xs">
			= {formatDuration(value)}
		</p>
	)
}
