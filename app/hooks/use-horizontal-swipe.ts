import { useCallback, useEffect, useRef } from 'react'
import {
	lockAxis,
	pushSample,
	releaseVelocity,
	rubberBand,
} from '#app/utils/swipe.ts'

const SETTLE = 'transform 300ms var(--ease-page-settle)'
/** A click this soon after a drag ends is the drag's, not a tap. */
const SWALLOW_CLICK_MS = 400

type Options = {
	enabled: boolean
	/** Where the element rests (px). A finger landing mid-settle catches it
	 * where it is instead. */
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
 * so a drag never re-renders. The click that ends a drag is swallowed. A
 * finger landing while the element settles, or while an entrance animation
 * runs on it, catches it where it is.
 */
export function useHorizontalSwipe<T extends HTMLElement>(options: Options) {
	const ref = useRef<T>(null)
	const optionsRef = useRef(options)
	optionsRef.current = options
	const swallowClickUntil = useRef(0)
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
			swallowClickUntil.current = 0
			const { enabled, getBase } = optionsRef.current
			if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return
			const element = ref.current
			if (!element) return
			cleanup.current?.()

			const pointerId = event.pointerId
			const startX = event.clientX
			const startY = event.clientY
			const resting = getBase()
			let base = resting
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
					// Catch the element where it is now: mid-settle, or partway
					// through an entrance, which would otherwise outrank the
					// transform written below.
					const shown = new DOMMatrix(getComputedStyle(element).transform).m41
					for (const animation of element.getAnimations()) animation.cancel()
					base = Number.isFinite(shown) ? shown : resting
				}
				const { min, max } = optionsRef.current
				offset = rubberBand(base + dx, min, max)
				moveTo(offset, false)
				pushSample(samples, { x: move.clientX, t: move.timeStamp })
			}

			const onUp = (up: PointerEvent) => {
				if (up.pointerId !== pointerId) return
				if (axis === 'x') {
					const velocity = releaseVelocity(
						samples,
						up.timeStamp,
						up.clientX - startX,
					)
					swallowClickUntil.current = up.timeStamp + SWALLOW_CLICK_MS
					moveTo(optionsRef.current.onRelease({ offset, velocity }), true)
				}
				stop()
			}

			const onCancel = (cancel: PointerEvent) => {
				if (cancel.pointerId !== pointerId) return
				if (axis === 'x') moveTo(resting, true)
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
		if (event.timeStamp > swallowClickUntil.current) return
		swallowClickUntil.current = 0
		event.preventDefault()
		event.stopPropagation()
	}, [])

	return { ref, moveTo, handlers: { onPointerDown, onClickCapture } }
}
