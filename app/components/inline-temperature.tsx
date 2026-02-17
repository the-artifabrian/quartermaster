import { useState } from 'react'
import { cn } from '#app/utils/misc.tsx'

export function InlineTemperature({
	originalText,
	converted,
}: {
	originalText: string
	converted: string
}) {
	const [open, setOpen] = useState(false)

	return (
		<span className="relative inline">
			<span
				role="button"
				tabIndex={0}
				onPointerEnter={(e) => {
					if (e.pointerType !== 'touch') setOpen(true)
				}}
				onPointerLeave={(e) => {
					if (e.pointerType !== 'touch') setOpen(false)
				}}
				onClick={(e) => {
					e.stopPropagation()
					setOpen((v) => !v)
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.stopPropagation()
						setOpen((v) => !v)
					}
				}}
				onBlur={() => setOpen(false)}
				className="decoration-muted-foreground/50 cursor-help underline decoration-dotted underline-offset-4"
			>
				{originalText}
			</span>
			<span
				className={cn(
					'bg-popover text-popover-foreground shadow-warm pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-opacity',
					open ? 'opacity-100' : 'opacity-0',
				)}
				aria-hidden={!open}
			>
				{converted}
			</span>
		</span>
	)
}
