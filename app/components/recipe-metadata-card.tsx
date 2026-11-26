import { Icon } from '#app/components/ui/icon.tsx'
import { formatDuration } from '#app/utils/format-duration.ts'
import { cn } from '#app/utils/misc.tsx'
import { scaledYield } from '#app/utils/target-yield.ts'

export function RecipeMetadataCard({
	activeTime,
	totalTime,
	yieldAmount,
	yieldLabel,
	sourceUrl,
	showYield = true,
	className,
}: {
	activeTime: number | null
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	sourceUrl: string | null
	showYield?: boolean
	className?: string
}) {
	const hasYield = showYield && yieldAmount != null && yieldLabel != null
	if (activeTime == null && totalTime == null && !hasYield && !sourceUrl) {
		return null
	}

	return (
		<div
			className={cn(
				'text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm print:mt-1',
				className,
			)}
		>
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
					Makes {yieldAmount} {yieldLabel}
				</span>
			)}
			{sourceUrl && <SourceLink url={sourceUrl} />}
		</div>
	)
}

function SourceLink({ url }: { url: string }) {
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className="hover:text-foreground inline-flex min-w-0 items-center gap-1 text-xs underline"
		>
			<Icon name="link-2" size="sm" className="shrink-0" />
			<span className="truncate">
				{(() => {
					try {
						return new URL(url).hostname.replace(/^www\./, '')
					} catch {
						return 'Source'
					}
				})()}
			</span>
		</a>
	)
}

/**
 * A Recipe's facts on a phone: Active, Total and what it makes, each a small
 * label over its value, with the source site under them. Only the facts it
 * has; none, and no source, draws nothing.
 */
export function RecipeFacts({
	activeTime,
	totalTime,
	yieldAmount,
	yieldLabel,
	scaleMultiplier,
	sourceUrl,
	className,
}: {
	activeTime: number | null
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	scaleMultiplier: number
	sourceUrl: string | null
	className?: string
}) {
	const makes = scaledYield(scaleMultiplier, { yieldAmount, yieldLabel })
	const facts = [
		activeTime != null && {
			label: 'Active',
			value: formatDuration(activeTime),
		},
		totalTime != null && { label: 'Total', value: formatDuration(totalTime) },
		makes && { label: 'Makes', value: `${makes.amount} ${makes.label}` },
	].filter((fact) => fact !== false && fact !== null)
	if (facts.length === 0 && !sourceUrl) return null

	return (
		<div className={cn('flex min-w-0 flex-col gap-3', className)}>
			{facts.length > 0 ? (
				<dl className="flex min-w-0 flex-wrap gap-x-[30px] gap-y-3">
					{facts.map((fact) => (
						<div key={fact.label} className="min-w-0">
							<dt className="text-muted-foreground text-label font-semibold">
								{fact.label}
							</dt>
							<dd className="mt-px text-base font-semibold wrap-anywhere">
								{fact.value}
							</dd>
						</div>
					))}
				</dl>
			) : null}
			{sourceUrl ? (
				<div className="text-muted-foreground flex min-w-0">
					<SourceLink url={sourceUrl} />
				</div>
			) : null}
		</div>
	)
}
