import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import { cn } from '#app/utils/misc.tsx'

/** A little over the collapse (tailwind.css, "Rows that close the gap"). */
const SETTLE_MS = 260

/**
 * A row that closes its gap when it goes and opens it again when it comes
 * back: its height and opacity ease together, so the rows under it move up
 * instead of jumping (tailwind.css, "Rows that close the gap"). A hidden row
 * stays mounted, out of reach of taps, Tab and VoiceOver, so Undo can bring
 * it back the same way.
 *
 * `instant` hides it without the animation (Clear checked), and its return
 * is instant too.
 */
export function RowCollapse({
	hidden: hiddenProp,
	instant = false,
	entering = false,
	className,
	children,
	as: Tag = 'div',
	...props
}: Omit<ComponentProps<'div'>, 'hidden'> & {
	hidden: boolean
	instant?: boolean
	/**
	 * Just brought back by Undo: a row mounting now starts shut and opens, as
	 * one still mounted does when `hidden` turns false.
	 */
	entering?: boolean
	/** `li` for a row of a list. */
	as?: 'div' | 'li'
	children: ReactNode
}) {
	const [shutOnMount, setShutOnMount] = useState(entering && !hiddenProp)
	useEffect(() => {
		if (!shutOnMount) return
		// Two frames: the shut state has to be painted for the open to animate.
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setShutOnMount(false))
		})
		return () => cancelAnimationFrame(frame)
	}, [shutOnMount])
	const hidden = hiddenProp || shutOnMount
	// How it went is how it comes back.
	const [instantReturn, setInstantReturn] = useState(instant)
	if (hidden && instant !== instantReturn) setInstantReturn(instant)
	// The content is clipped only while the row is shut or moving, so a
	// card's shadow and focus ring show the rest of the time.
	const [clipping, setClipping] = useState(hidden)
	if (hidden && !clipping) setClipping(true)
	useEffect(() => {
		if (hidden || !clipping) return
		const timeout = window.setTimeout(() => setClipping(false), SETTLE_MS)
		return () => window.clearTimeout(timeout)
	}, [hidden, clipping])

	return (
		<Tag
			{...(props as ComponentProps<'li'> & ComponentProps<'div'>)}
			data-row-collapse=""
			data-hidden={hidden ? '' : undefined}
			data-instant={instantReturn ? '' : undefined}
			aria-hidden={hidden || undefined}
			inert={hidden}
			className={className}
		>
			<div className={cn('min-h-0', clipping && 'overflow-hidden')}>
				{children}
			</div>
		</Tag>
	)
}
