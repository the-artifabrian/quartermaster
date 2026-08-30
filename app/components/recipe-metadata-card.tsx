import { Icon } from '#app/components/ui/icon.tsx'

function formatDuration(minutes: number) {
	if (minutes < 60) return `${minutes} min`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	return `${hours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ''}`
}

export function RecipeMetadataCard({
	activeTime,
	totalTime,
	yieldAmount,
	yieldLabel,
	sourceUrl,
}: {
	activeTime: number | null
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	sourceUrl: string | null
}) {
	const hasYield = yieldAmount != null && yieldLabel != null
	if (activeTime == null && totalTime == null && !hasYield && !sourceUrl) {
		return null
	}

	return (
		<div className="text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm print:mt-1">
			{activeTime != null && (
				<span className="inline-flex items-center gap-1">
					<Icon name="timer" size="sm" className="shrink-0 opacity-70" />
					Active: {formatDuration(activeTime)}
				</span>
			)}
			{totalTime != null && (
				<span className="inline-flex items-center gap-1">
					<Icon name="clock" size="sm" className="shrink-0 opacity-70" />
					Total: {formatDuration(totalTime)}
				</span>
			)}
			{hasYield && (
				<span className="max-w-full min-w-0 break-all">
					Yield: {yieldAmount} {yieldLabel}
				</span>
			)}
			{sourceUrl && (
				<a
					href={sourceUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground inline-flex min-w-0 items-center gap-1 text-xs underline"
				>
					<Icon name="link-2" size="sm" className="shrink-0" />
					<span className="truncate">
						{(() => {
							try {
								return new URL(sourceUrl).hostname.replace(/^www\./, '')
							} catch {
								return 'Source'
							}
						})()}
					</span>
				</a>
			)}
		</div>
	)
}
