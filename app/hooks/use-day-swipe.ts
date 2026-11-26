import { useCallback, useEffect, useRef } from 'react'
import { canStartDaySwipe, daySwipeStep } from '#app/utils/plan-day-swipe.ts'
import { lockAxis } from '#app/utils/swipe.ts'

/** A click this soon after a sideways drag ends is the drag's, not a tap. */
const SWALLOW_CLICK_MS = 400

/**
 * A sideways swipe on a phone's Plan day that steps to the next day or the
 * one before when the finger lifts. The day stays still under the finger and
 * changes at once. The surface needs `touch-action: pan-y`, so a vertical
 * drag stays a scroll (the browser cancels the pointer) and only a sideways
 * one reaches here. Mouse pointers are ignored: the strip is a click away.
 * The click that ends a sideways drag is swallowed, so a swipe that starts on
 * a dish name never opens the Recipe.
 */
export function useDaySwipe<T extends HTMLElement>({
	enabled,
	onStep,
}: {
	enabled: boolean
	onStep: (step: 1 | -1) => void
}) {
	const optionsRef = useRef({ enabled, onStep })
	optionsRef.current = { enabled, onStep }
	const swallowClickUntil = useRef(0)
	const cleanup = useRef<(() => void) | null>(null)

	useEffect(() => () => cleanup.current?.(), [])

	const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
		swallowClickUntil.current = 0
		if (!optionsRef.current.enabled) return
		if (event.pointerType === 'mouse' || !event.isPrimary) return
		if (!canStartDaySwipe(event.currentTarget, event.target)) return
		cleanup.current?.()

		const pointerId = event.pointerId
		const startX = event.clientX
		const startY = event.clientY
		let axis: 'x' | 'y' | null = null

		const onMove = (move: PointerEvent) => {
			if (move.pointerId !== pointerId || axis !== null) return
			axis = lockAxis(move.clientX - startX, move.clientY - startY)
			if (axis === 'y') stop()
		}

		const onUp = (up: PointerEvent) => {
			if (up.pointerId !== pointerId) return
			stop()
			if (axis !== 'x') return
			swallowClickUntil.current = up.timeStamp + SWALLOW_CLICK_MS
			const step = daySwipeStep(up.clientX - startX, up.clientY - startY)
			if (step !== 0 && optionsRef.current.enabled) {
				optionsRef.current.onStep(step)
			}
		}

		const onCancel = (cancel: PointerEvent) => {
			if (cancel.pointerId === pointerId) stop()
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
	}, [])

	const onClickCapture = useCallback((event: React.MouseEvent<T>) => {
		if (event.timeStamp > swallowClickUntil.current) return
		swallowClickUntil.current = 0
		event.preventDefault()
		event.stopPropagation()
	}, [])

	return { onPointerDown, onClickCapture }
}
