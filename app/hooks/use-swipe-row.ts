import { useEffect, useRef, useState } from 'react'
import { haptic } from '#app/utils/shell-bridge.ts'
import { settleReveal } from '#app/utils/swipe.ts'
import { useHorizontalSwipe } from './use-horizontal-swipe.ts'

/** The row whose actions are showing, in any list. Opening another shuts it. */
let openRow: { close: () => void } | null = null

type Options = {
	enabled: boolean
	/** How far the row slides to uncover its actions (px). */
	width: number
	/** After a swipe settles, open or shut. */
	onSwiped?: (open: boolean) => void
}

/**
 * A list row that swipes left to uncover actions behind it, as on Shopping
 * and Staples: it follows the finger (`useHorizontalSwipe`) and settles open
 * or shut, only one row in the app is open at a time, and a tap on an open
 * row shuts it instead of reaching what is under the finger.
 *
 * Spread `handlers` on the sliding layer and give it `ref`.
 */
export function useSwipeRow<T extends HTMLElement>({
	enabled,
	width,
	onSwiped,
}: Options) {
	const [open, setOpen] = useState(false)
	const self = useRef<{ close: () => void } | null>(null)
	const swipe = useHorizontalSwipe<T>({
		enabled,
		getBase: () => (open ? -width : 0),
		min: -width,
		max: 0,
		onRelease: ({ offset, velocity }) => {
			const next = settleReveal({ offset, velocity, width })
			if (next) {
				if (!open) haptic('selection')
				claim()
			} else {
				release()
			}
			setOpen(next)
			onSwiped?.(next)
			return next ? -width : 0
		},
	})
	self.current ??= {
		close: () => {
			swipe.moveTo(0, true)
			setOpen(false)
		},
	}

	function claim() {
		if (openRow !== self.current) openRow?.close()
		openRow = self.current
	}
	function release() {
		if (openRow === self.current) openRow = null
	}

	/** Slides the row shut. */
	function close() {
		self.current?.close()
		release()
	}

	/** Slides the row open without a swipe (a keyboard reaching its actions). */
	function show() {
		claim()
		swipe.moveTo(-width, true)
		setOpen(true)
	}

	/**
	 * After a delete from the row: it collapses as it is, actions showing, and
	 * shuts once out of sight, so Undo brings it back shut.
	 */
	function closeAfterDelete() {
		window.setTimeout(close, 250)
	}

	// A change in how many actions there are keeps an open row clear of them.
	const moveTo = swipe.moveTo
	useEffect(() => {
		if (open) moveTo(-width, true)
	}, [width, open, moveTo])

	const handlers = {
		onPointerDown: (event: React.PointerEvent<T>) => {
			// A portaled menu's events bubble here through React; they are not
			// the row's.
			if (!event.currentTarget.contains(event.target as Node)) return
			swipe.handlers.onPointerDown(event)
		},
		onClickCapture: (event: React.MouseEvent<T>) => {
			if (!event.currentTarget.contains(event.target as Node)) return
			if (open) {
				event.preventDefault()
				event.stopPropagation()
				close()
				return
			}
			swipe.handlers.onClickCapture(event)
		},
	}

	return { ref: swipe.ref, open, handlers, close, show, closeAfterDelete }
}
