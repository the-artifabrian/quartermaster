import { useCallback, useEffect, useRef } from 'react'

const ACTION_WIDTH = 80
const SNAP_THRESHOLD = ACTION_WIDTH * 0.4
const FULL_SWIPE_FRACTION = 0.5
const DEAD_ZONE = 10

// Module-level: only one row open at a time
let closeOpenRow: (() => void) | null = null

type SwipeableRowProps = {
	onAction: () => void
	actionLabel?: string
	children: React.ReactNode
}

export function SwipeableRow({
	onAction,
	actionLabel = 'Delete',
	children,
}: SwipeableRowProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const foregroundRef = useRef<HTMLDivElement>(null)
	const offsetRef = useRef(0)
	const startXRef = useRef(0)
	const startYRef = useRef(0)
	const lockedRef = useRef<'horizontal' | 'vertical' | null>(null)
	const isOpenRef = useRef(false)
	const widthRef = useRef(0)
	const onActionRef = useRef(onAction)
	onActionRef.current = onAction

	const snapTo = useCallback((target: number) => {
		const el = foregroundRef.current
		if (!el) return
		el.style.transition = 'transform 200ms var(--ease-micro)'
		el.style.transform = `translateX(${target}px)`
		offsetRef.current = target
		isOpenRef.current = target !== 0
	}, [])

	const close = useCallback(() => {
		snapTo(0)
		if (closeOpenRow === close) closeOpenRow = null
	}, [snapTo])

	// Clean up module-level ref on unmount (e.g. optimistic delete)
	useEffect(() => {
		return () => {
			if (closeOpenRow === close) closeOpenRow = null
		}
	}, [close])

	const handleTouchStart = useCallback(
		(e: React.TouchEvent) => {
			// Close any other open row
			if (closeOpenRow && closeOpenRow !== close) {
				closeOpenRow()
			}

			const touch = e.touches[0]!
			startXRef.current = touch.clientX
			startYRef.current = touch.clientY
			lockedRef.current = null
			widthRef.current = containerRef.current?.offsetWidth ?? 0

			const el = foregroundRef.current
			if (el) {
				el.style.transition = 'none'
			}
		},
		[close],
	)

	const handleTouchMove = useCallback((e: React.TouchEvent) => {
		const touch = e.touches[0]!
		const deltaX = touch.clientX - startXRef.current
		const deltaY = touch.clientY - startYRef.current

		if (!lockedRef.current) {
			if (Math.abs(deltaX) < DEAD_ZONE && Math.abs(deltaY) < DEAD_ZONE) {
				return
			}
			lockedRef.current =
				Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical'
		}

		if (lockedRef.current === 'vertical') return

		const baseOffset = isOpenRef.current ? -ACTION_WIDTH : 0
		let raw = baseOffset + deltaX
		// Rubber-band: gentle resistance past action width, stronger past 0
		if (raw > 0) {
			raw = raw * 0.2
		} else if (raw < -ACTION_WIDTH) {
			raw = -ACTION_WIDTH + (raw + ACTION_WIDTH) * 0.5
		}

		const el = foregroundRef.current
		if (el) {
			el.style.transform = `translateX(${raw}px)`
		}
		offsetRef.current = raw
	}, [])

	const handleTouchEnd = useCallback(() => {
		if (lockedRef.current !== 'horizontal') {
			// No horizontal gesture happened — reset
			lockedRef.current = null
			return
		}

		const fullSwipeThreshold = widthRef.current * FULL_SWIPE_FRACTION

		if (
			fullSwipeThreshold > 0 &&
			Math.abs(offsetRef.current) > fullSwipeThreshold
		) {
			// Full swipe — trigger action directly
			onActionRef.current()
		} else if (offsetRef.current < -SNAP_THRESHOLD) {
			snapTo(-ACTION_WIDTH)
			closeOpenRow = close
		} else {
			snapTo(0)
			if (closeOpenRow === close) closeOpenRow = null
		}
		lockedRef.current = null
	}, [snapTo, close])

	// Browser took over (e.g. vertical scroll) — snap back to pre-gesture state
	const handleTouchCancel = useCallback(() => {
		snapTo(isOpenRef.current ? -ACTION_WIDTH : 0)
		lockedRef.current = null
	}, [snapTo])

	return (
		<div ref={containerRef} className="relative overflow-hidden">
			{/* Action layer — full width so red bg extends on long swipes */}
			<div className="absolute inset-0 flex items-stretch justify-end bg-destructive">
				<button
					type="button"
					onClick={onAction}
					className="flex w-[80px] items-center justify-center bg-destructive text-destructive-foreground text-sm font-medium"
				>
					{actionLabel}
				</button>
			</div>

			{/* Foreground — children with opaque bg, touch-pan-y lets browser
			   handle vertical scroll while JS handles horizontal swipe */}
			<div
				ref={foregroundRef}
				className="relative touch-pan-y bg-background"
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				onTouchCancel={handleTouchCancel}
			>
				{children}
			</div>
		</div>
	)
}
