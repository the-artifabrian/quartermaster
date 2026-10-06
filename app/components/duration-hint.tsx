import { formatDuration } from '#app/utils/format-duration.ts'
import { cn } from '#app/utils/misc.tsx'

/**
 * Restates a minutes input in hours and days once it reaches an hour, so
 * "1140" reads as "= 19 hr" while the input keeps submitting minutes.
 * Point the input's aria-describedby at `id`.
 */
export function DurationHint({
	id,
	minutes,
	className,
}: {
	id: string
	// RecipeSchema preprocesses times, so Conform types their value as unknown.
	minutes: unknown
	className?: string
}) {
	const value =
		typeof minutes === 'string' && minutes.trim() ? Number(minutes) : Number.NaN
	// Only whole minutes are valid, so a decimal gets no hint.
	if (!Number.isInteger(value) || value < 60) return null
	return (
		<p id={id} className={cn('text-muted-foreground text-xs', className)}>
			= {formatDuration(value)}
		</p>
	)
}
