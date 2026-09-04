import { useId, useRef, useState } from 'react'
import { cn } from '#app/utils/misc.tsx'

export function InlineTemperature({
	originalText,
	converted,
}: {
	originalText: string
	converted: string
}) {
	const [open, setOpen] = useState(false)
	const tooltipId = useId()
	const pointerHovering = useRef(false)

	return (
		<span className="relative inline">
			<span
				role="button"
				tabIndex={0}
				data-cooking-cue="temperature"
				aria-label={`${originalText}, converts to ${converted}`}
				aria-describedby={open ? tooltipId : undefined}
				onPointerEnter={(e) => {
					if (e.pointerType !== 'touch') {
						pointerHovering.current = true
						setOpen(true)
					}
				}}
				onPointerLeave={(e) => {
					if (e.pointerType !== 'touch') {
						pointerHovering.current = false
						setOpen(false)
					}
				}}
				onClick={(e) => {
					e.stopPropagation()
					// A mouse click follows pointer-enter, which may already have opened
					// the cue. Keep it open for mouse users; touch and keyboard users can
					// toggle the cue from the same control.
					setOpen((value) => (pointerHovering.current ? true : !value))
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						e.stopPropagation()
						setOpen((v) => !v)
					} else if (e.key === 'Escape') {
						e.stopPropagation()
						setOpen(false)
					}
				}}
				onBlur={() => setOpen(false)}
				className="text-copper-text decoration-copper-text/50 focus-visible:ring-ring cursor-help rounded-sm font-semibold underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:outline-none print:text-inherit print:no-underline"
			>
				{originalText}
			</span>
			<span
				id={tooltipId}
				role="tooltip"
				className={cn(
					'bg-popover text-popover-foreground shadow-warm-md pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-opacity',
					open ? 'opacity-100' : 'opacity-0',
				)}
				aria-hidden={!open}
			>
				{converted}
			</span>
		</span>
	)
}
