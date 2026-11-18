import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import {
	pushSample,
	releaseVelocity,
	rubberBand,
	settleDismiss,
	sheetDragIntent,
} from '#app/utils/swipe.ts'

const SETTLE_MS = 300
const PANEL_SETTLE = `transform ${SETTLE_MS}ms var(--ease-page-settle)`
const BACKDROP_SETTLE = `opacity ${SETTLE_MS}ms var(--ease-page-settle)`
/** A click this soon after a drag ends is the drag's, not a tap. */
const SWALLOW_CLICK_MS = 400

type Options = {
	open: boolean
	/** Off for a sheet that is not attached to the bottom edge. */
	enabled: () => boolean
	panelRef: RefObject<HTMLElement | null>
	backdropRef: RefObject<HTMLElement | null>
	onDismiss: () => void
}

/**
 * Pull a bottom sheet down to close it. While the finger is down the panel
 * follows it 1:1 and the backdrop fades with it; when it lifts, the sheet
 * closes on a flick down or a pull past a third of its height, and settles
 * back otherwise. A pull down only takes the sheet once the content under the
 * finger is scrolled to its top, so scrolling a long sheet still scrolls.
 *
 * Touch only: a mouse closes the sheet with the backdrop, Escape or Close.
 * Positions go straight to inline styles, so a drag never re-renders. They
 * are `!important` so the drag still tracks the finger under reduced motion,
 * whose sheet rules pin the panel's transform.
 */
export function useSheetDrag({
	open,
	enabled,
	panelRef,
	backdropRef,
	onDismiss,
}: Options) {
	const optionsRef = useRef({ enabled, onDismiss })
	useEffect(() => {
		optionsRef.current = { enabled, onDismiss }
	})

	// When the sheet closes, hand the panel back to the stylesheet's exit,
	// which starts from wherever the drag left it. Under reduced motion the
	// exit is a fade in place, so the panel stays where it was let go.
	useLayoutEffect(() => {
		const panel = panelRef.current
		const backdrop = backdropRef.current
		if (!panel || !backdrop) return
		panel.style.removeProperty('transition')
		backdrop.style.removeProperty('transition')
		backdrop.style.removeProperty('opacity')
		const reduced = window.matchMedia?.(
			'(prefers-reduced-motion: reduce)',
		).matches
		if (open || !reduced) panel.style.removeProperty('transform')
	}, [open, panelRef, backdropRef])

	useEffect(() => {
		const panel = panelRef.current
		if (!open || !panel) return

		type Gesture = {
			id: number
			startX: number
			startY: number
			atTop: boolean
			canScroll: boolean
			intent: 'wait' | 'sheet'
			/** Where the finger was when the sheet took the gesture. */
			lockY: number
			offset: number
			height: number
			samples: Array<{ x: number; t: number }>
		}
		let gesture: Gesture | null = null
		let swallowClickUntil = 0
		let clearSettle = 0

		const backdrop = () => backdropRef.current

		function moveTo(offset: number) {
			panel!.style.setProperty(
				'transform',
				`translateY(${offset}px)`,
				'important',
			)
			const fade = Math.min(Math.max(offset / gesture!.height, 0), 1)
			backdrop()?.style.setProperty('opacity', String(1 - fade))
		}

		function settleBack() {
			panel!.style.transition = PANEL_SETTLE
			panel!.style.removeProperty('transform')
			const shade = backdrop()
			if (shade) {
				shade.style.transition = BACKDROP_SETTLE
				shade.style.removeProperty('opacity')
			}
			// The settle's inline transition would also override the
			// stylesheet's exit, so it goes once the settle is done.
			window.clearTimeout(clearSettle)
			clearSettle = window.setTimeout(() => {
				panel!.style.removeProperty('transition')
				backdrop()?.style.removeProperty('transition')
			}, SETTLE_MS)
		}

		const findTouch = (list: TouchList, id: number) =>
			Array.from(list).find((touch) => touch.identifier === id)

		function onTouchStart(event: TouchEvent) {
			// A finger that lifted off a node the page then removed never told
			// the panel it ended: that gesture is over. Its id can come back for
			// the next finger.
			if (
				gesture &&
				(!findTouch(event.touches, gesture.id) ||
					findTouch(event.changedTouches, gesture.id))
			) {
				const stale = gesture
				gesture = null
				if (stale.intent === 'sheet') settleBack()
			}
			// A second finger is ignored, so the sheet never jumps to it.
			if (gesture) return
			// A new touch's click is its own, whatever the last drag was.
			swallowClickUntil = 0
			if (!optionsRef.current.enabled()) return
			const touch = event.changedTouches[0]
			if (!touch) return
			const scroller = scrollerUnder(event.target as Element, panel!)
			if (scroller === 'sideways') return
			gesture = {
				id: touch.identifier,
				startX: touch.clientX,
				startY: touch.clientY,
				// Rounded: iOS can leave a list a fraction of a pixel from its top.
				atTop: scroller.scrollTop < 1 && panel!.scrollTop < 1,
				// With the keyboard up, a push up pans the page to the field the
				// keyboard covers, as if the sheet could scroll.
				canScroll:
					scroller.scrollHeight > scroller.clientHeight || keyboardUp(),
				intent: 'wait',
				lockY: touch.clientY,
				offset: 0,
				height: panel!.offsetHeight,
				samples: [],
			}
		}

		function onTouchMove(event: TouchEvent) {
			if (!gesture) return
			const touch = findTouch(event.changedTouches, gesture.id)
			if (!touch) return
			const dx = touch.clientX - gesture.startX
			const dy = touch.clientY - gesture.startY
			if (gesture.intent === 'wait') {
				const intent = sheetDragIntent({
					dx,
					dy,
					atTop: gesture.atTop,
					canScroll: gesture.canScroll,
				})
				if (intent === 'scroll') {
					gesture = null
					return
				}
				if (intent === 'wait') {
					// iOS gives a touch to scrolling on its first moves, before
					// they leave the slop, and then can't take it back. Hold them
					// where the sheet is about to take the gesture.
					const sheetLikely = dy > 0 ? gesture.atTop : !gesture.canScroll
					if (sheetLikely && event.cancelable) event.preventDefault()
					return
				}
				// A move iOS has already given to scrolling can't be taken back:
				// moving the sheet too would move both at once.
				if (!event.cancelable) {
					gesture = null
					return
				}
				gesture.intent = 'sheet'
				// Caught mid-settle, the sheet carries on from where it shows.
				const shown = new DOMMatrix(getComputedStyle(panel!).transform).m42
				gesture.lockY = touch.clientY - Math.max(shown, 0)
				window.clearTimeout(clearSettle)
				panel!.style.transition = 'none'
				const shade = backdrop()
				if (shade) shade.style.transition = 'none'
			}
			if (event.cancelable) event.preventDefault()
			gesture.offset = rubberBand(touch.clientY - gesture.lockY, 0, Infinity)
			moveTo(gesture.offset)
			pushSample(gesture.samples, { x: touch.clientY, t: event.timeStamp })
		}

		function onTouchEnd(event: TouchEvent) {
			if (!gesture) return
			if (!findTouch(event.changedTouches, gesture.id)) return
			const ended = gesture
			gesture = null
			if (ended.intent !== 'sheet') return
			swallowClickUntil = event.timeStamp + SWALLOW_CLICK_MS
			const lifted = findTouch(event.changedTouches, ended.id)!
			const velocity = releaseVelocity(
				ended.samples,
				event.timeStamp,
				lifted.clientY - ended.lockY,
			)
			const dismiss =
				event.type === 'touchend' &&
				settleDismiss({ offset: ended.offset, velocity, height: ended.height })
			if (dismiss) optionsRef.current.onDismiss()
			else settleBack()
		}

		function onClickCapture(event: MouseEvent) {
			if (event.timeStamp > swallowClickUntil) return
			swallowClickUntil = 0
			event.preventDefault()
			event.stopPropagation()
		}

		const active = { passive: false } as const
		panel.addEventListener('touchstart', onTouchStart, { passive: true })
		panel.addEventListener('touchmove', onTouchMove, active)
		panel.addEventListener('touchend', onTouchEnd)
		panel.addEventListener('touchcancel', onTouchEnd)
		panel.addEventListener('click', onClickCapture, true)
		return () => {
			window.clearTimeout(clearSettle)
			panel.removeEventListener('touchstart', onTouchStart)
			panel.removeEventListener('touchmove', onTouchMove)
			panel.removeEventListener('touchend', onTouchEnd)
			panel.removeEventListener('touchcancel', onTouchEnd)
			panel.removeEventListener('click', onClickCapture, true)
		}
	}, [open, panelRef, backdropRef])
}

/**
 * The element whose vertical scroll a touch on `target` would move: the
 * nearest one that scrolls between it and the panel, else the panel. A touch
 * inside something that scrolls sideways is left alone: holding back its
 * first moves would stop it scrolling.
 */
function scrollerUnder(target: Element, panel: HTMLElement) {
	for (
		let element: Element | null = target;
		element && element !== panel;
		element = element.parentElement
	) {
		const style = getComputedStyle(element)
		const scrolls = (overflow: string) =>
			overflow === 'auto' || overflow === 'scroll'
		// Vertical first: `overflow-y: auto` makes overflow-x compute to auto
		// too, so a list a pixel too wide would otherwise read as sideways.
		if (
			scrolls(style.overflowY) &&
			element.scrollHeight > element.clientHeight
		) {
			return element
		}
		if (
			scrolls(style.overflowX) &&
			element.scrollWidth > element.clientWidth + 1
		) {
			return 'sideways' as const
		}
	}
	return panel
}

/**
 * Whether the soft keyboard is up: on iOS it shrinks the visual viewport and
 * leaves the layout viewport as it was.
 */
function keyboardUp() {
	const viewport = window.visualViewport
	return !!viewport && window.innerHeight - viewport.height > 150
}
