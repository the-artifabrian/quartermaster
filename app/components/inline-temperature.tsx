import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'

export function InlineTemperature({
	originalText,
	converted,
}: {
	originalText: string
	converted: string
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="button"
					tabIndex={0}
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.stopPropagation()
						}
					}}
					className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4"
				>
					{originalText}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				<span className="font-medium">{converted}</span>
			</TooltipContent>
		</Tooltip>
	)
}
