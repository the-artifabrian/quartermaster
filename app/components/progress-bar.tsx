import { useEffect, useState } from 'react'
import { useNavigation } from 'react-router'
import { useSpinDelay } from 'spin-delay'
import { Icon } from './ui/icon.tsx'

/**
 * Top-of-screen navigation progress bar.
 *
 * Previously the bar snapped to a fixed width (66%) and HELD there for the whole
 * loader round-trip, so any nav slower than ~600ms looked frozen ("stuck partway
 * across"). Now it trickles asymptotically toward ~90% while pending — so it
 * always reads as live progress — then completes to 100% and fades on idle.
 *
 * spin-delay still gates visibility: nothing shows for navs faster than `delay`,
 * and once shown it stays for at least `minDuration` to avoid a flash.
 */
function Progress() {
	const transition = useNavigation()
	const busy = transition.state !== 'idle'
	const delayedPending = useSpinDelay(busy, {
		delay: 500,
		minDuration: 300,
	})
	const [bar, setBar] = useState({ width: 0, visible: false })

	useEffect(() => {
		if (delayedPending) {
			// Start the bar and trickle toward 90% (never reaching it until done).
			setBar({ width: 8, visible: true })
			const id = setInterval(() => {
				setBar((b) => ({
					...b,
					width: b.width < 90 ? b.width + (90 - b.width) * 0.12 : b.width,
				}))
			}, 300)
			return () => clearInterval(id)
		}

		// Not pending: complete to 100% if we were showing, then fade out.
		setBar((b) => (b.visible ? { ...b, width: 100 } : b))
		const id = setTimeout(() => setBar({ width: 0, visible: false }), 300)
		return () => clearTimeout(id)
	}, [delayedPending])

	return (
		<div
			role="progressbar"
			aria-hidden={delayedPending ? undefined : true}
			aria-valuetext={delayedPending ? 'Loading' : undefined}
			className="fixed inset-x-0 top-0 z-50 h-[0.20rem]"
		>
			<div
				className="bg-accent h-full transition-[width,opacity] duration-300 ease-out"
				style={{ width: `${bar.width}%`, opacity: bar.visible ? 1 : 0 }}
			/>
			{delayedPending && (
				<div className="absolute flex items-center justify-center">
					<Icon
						name="update"
						size="md"
						className="text-foreground m-1 animate-spin"
						aria-hidden
					/>
				</div>
			)}
		</div>
	)
}

export { Progress }
