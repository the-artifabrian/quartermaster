import { useEffect, useRef, useState } from 'react'
import { cn } from '#app/utils/misc.tsx'

/**
 * Personal Recipe notes: copper edge, quiet sans, collapsed to a few lines
 * by default so a long process note never pushes Ingredients off screen.
 * The toggle only appears when the note actually overflows the clamp.
 */
export function RecipeNotes({
	notes,
	className,
}: {
	notes: string
	className?: string
}) {
	const [expanded, setExpanded] = useState(false)
	const [overflows, setOverflows] = useState(false)
	const textRef = useRef<HTMLParagraphElement>(null)

	useEffect(() => {
		const el = textRef.current
		if (!el) return
		const measure = () => {
			if (expanded) return
			setOverflows(el.scrollHeight > el.clientHeight + 1)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [expanded, notes])

	return (
		<div
			className={cn(
				'border-accent bg-accent/5 rounded-lg border-l-[3px] py-2.5 pr-3 pl-3.5 print:break-inside-avoid',
				className,
			)}
		>
			<p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
				Notes
			</p>
			<p
				ref={textRef}
				id="recipe-notes-text"
				className={cn(
					'text-[15px] leading-relaxed whitespace-pre-wrap',
					!expanded && 'line-clamp-3 print:line-clamp-none',
				)}
			>
				{notes}
			</p>
			{overflows || expanded ? (
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls="recipe-notes-text"
					onClick={() => setExpanded((value) => !value)}
					className="text-primary hover:text-primary/80 focus-visible:ring-ring mt-1 -ml-1 min-h-9 rounded-sm px-1 text-sm font-medium focus-visible:ring-2 focus-visible:outline-hidden print:hidden"
				>
					{expanded ? 'Show less' : 'Show more'}
				</button>
			) : null}
		</div>
	)
}
