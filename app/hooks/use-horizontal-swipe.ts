import { useCallback, useEffect, useRef } from 'react'
import { lockAxis, rubberBand } from '#app/utils/swipe.ts'

/** Release velocity is read over the last stretch of the drag. */
const VELOCITY_WINDOW_MS = 100
const SETTLE = 'transform 300ms var(--ease-page-settle)'

type Options = {
	enabled: boolean
	/** Where the element rests when the finger lands (px). */
	getBase: () => number
	/** The range the element follows the finger in; past it, it resists. */
	min: number
	max: number
	/** Picks where the element settles; returns the offset (px). */
	onRelease: (release: { offset: number; velocity: number }) => number
}

/**
 * A horizontal touch swipe that follows the finger 1:1 and settles with a CSS
 * transition when it lifts. Mouse pointers are ignored: the same actions are
 * a tap away on desktop. The element needs `touch-action: pan-y`, so vertical
 * scrolling stays with the browser and only a sideways drag reaches here.
 *
 * Positions are written straight to the element's transform, not React state,
 * so a drag never re-renders. The click that ends a drag is swallowed.
 */
export function useHorizontalSwipe<T extends HTMLElement>(options: Options) {
	const ref = useRef<T>(null)
	const optionsRef = useRef(options)
	optionsRef.current = options
	const swallowClick = useRef(false)
	const cleanup = useRef<(() => void) | null>(null)

	useEffect(() => () => cleanup.current?.(), [])

	/** Moves the element to an offset, settling if `animate`. */
	const moveTo = useCallback((offset: number, animate: boolean) => {
		const element = ref.current
		if (!element) return
		element.style.transition = animate ? SETTLE : 'none'
		element.style.transform = offset === 0 ? '' : `translateX(${offset}px)`
	}, [])

	const onPointerDown = useCallback(
		(event: React.PointerEvent<T>) => {
			// A drag that ended away from where it started fires no click, so
			// a stale flag must not swallow this gesture's tap.
			swallowClick.current = false
			const { enabled, getBase } = optionsRef.current
			if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return
			const element = ref.current
			if (!element) return
			cleanup.current?.()

			const pointerId = event.pointerId
			const startX = event.clientX
			const startY = event.clientY
			const base = getBase()
			let axis: 'x' | 'y' | null = null
			let offset = base
			const samples: Array<{ x: number; t: number }> = []

			const onMove = (move: PointerEvent) => {
				if (move.pointerId !== pointerId) return
				const dx = move.clientX - startX
				const dy = move.clientY - startY
				if (axis === null) {
					axis = lockAxis(dx, dy)
					if (axis === 'y') return stop()
					if (axis === null) return
					element.setPointerCapture?.(pointerId)
				}
				const { min, max } = optionsRef.current
				offset = rubberBand(base + dx, min, max)
				moveTo(offset, false)
				samples.push({ x: move.clientX, t: move.timeStamp })
				while (
					samples.length > 2 &&
					move.timeStamp - samples[0]!.t > VELOCITY_WINDOW_MS
				) {
					samples.shift()
				}
			}

			const onUp = (up: PointerEvent) => {
				if (up.pointerId !== pointerId) return
				if (axis === 'x') {
					const first = samples[0]
					const last = samples[samples.length - 1]
					const elapsed = first && last ? last.t - first.t : 0
					const velocity =
						first && last && elapsed > 0 ? (last.x - first.x) / elapsed : 0
					swallowClick.current = true
					moveTo(optionsRef.current.onRelease({ offset, velocity }), true)
				}
				stop()
			}

			const onCancel = (cancel: PointerEvent) => {
				if (cancel.pointerId !== pointerId) return
				if (axis === 'x') moveTo(base, true)
				stop()
			}

			function stop() {
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
				window.removeEventListener('pointercancel', onCancel)
				cleanup.current = null
			}

			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
			window.addEventListener('pointercancel', onCancel)
			cleanup.current = stop
		},
		[moveTo],
	)

	const onClickCapture = useCallback((event: React.MouseEvent<T>) => {
		if (!swallowClick.current) return
		swallowClick.current = false
		event.preventDefault()
		event.stopPropagation()
	}, [])

	return { ref, moveTo, handlers: { onPointerDown, onClickCapture } }
}
