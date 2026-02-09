import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'

type TimerStatus = 'idle' | 'running' | 'paused' | 'alarming'

function useCookingTimer() {
	const [status, setStatus] = useState<TimerStatus>('idle')
	const [remainingSeconds, setRemainingSeconds] = useState(0)
	const endTimeRef = useRef<number | null>(null)
	const pausedRemainingRef = useRef(0)

	useEffect(() => {
		if (status !== 'running') return

		const tick = () => {
			const now = Date.now()
			const end = endTimeRef.current!
			const remaining = Math.max(0, Math.ceil((end - now) / 1000))
			setRemainingSeconds(remaining)

			if (remaining <= 0) {
				setStatus('alarming')
				playAlarmSound()
			}
		}

		tick()
		const id = setInterval(tick, 250)
		return () => clearInterval(id)
	}, [status])

	const start = useCallback((seconds: number) => {
		setRemainingSeconds(seconds)
		endTimeRef.current = Date.now() + seconds * 1000
		setStatus('running')
	}, [])

	const pause = useCallback(() => {
		if (status !== 'running') return
		const now = Date.now()
		const remaining = Math.max(0, (endTimeRef.current! - now) / 1000)
		pausedRemainingRef.current = remaining
		setRemainingSeconds(Math.ceil(remaining))
		setStatus('paused')
	}, [status])

	const resume = useCallback(() => {
		if (status !== 'paused') return
		endTimeRef.current = Date.now() + pausedRemainingRef.current * 1000
		setStatus('running')
	}, [status])

	const reset = useCallback(() => {
		endTimeRef.current = null
		pausedRemainingRef.current = 0
		setRemainingSeconds(0)
		setStatus('idle')
	}, [])

	return { status, remainingSeconds, start, pause, resume, reset }
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60
	if (h > 0) {
		return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
	}
	return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function playAlarmSound() {
	try {
		const ctx = new AudioContext()
		const beep = (startTime: number) => {
			const osc = ctx.createOscillator()
			const gain = ctx.createGain()
			osc.connect(gain)
			gain.connect(ctx.destination)
			osc.frequency.value = 880
			osc.type = 'square'
			gain.gain.setValueAtTime(0.3, startTime)
			gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15)
			osc.start(startTime)
			osc.stop(startTime + 0.15)
		}
		beep(ctx.currentTime)
		beep(ctx.currentTime + 0.25)
		beep(ctx.currentTime + 0.5)
	} catch {
		// Web Audio not available, try vibration
		navigator.vibrate?.([200, 100, 200, 100, 200])
	}
}

const PRESETS = [1, 5, 10, 15, 30] as const

export function CookingTimer({
	wakeLock,
}: {
	wakeLock: { isActive: boolean; toggle: () => void }
}) {
	const [isExpanded, setIsExpanded] = useState(false)
	const [customMinutes, setCustomMinutes] = useState(10)
	const timer = useCookingTimer()
	const wakeLockAutoRef = useRef(false)
	const toggleRef = useRef(wakeLock.toggle) as MutableRefObject<() => void>
	toggleRef.current = wakeLock.toggle

	// Auto-manage wake lock: enable when timer starts, release when done/reset
	useEffect(() => {
		if (timer.status === 'running' && !wakeLock.isActive) {
			toggleRef.current()
			wakeLockAutoRef.current = true
		} else if (
			(timer.status === 'idle' || timer.status === 'alarming') &&
			wakeLock.isActive &&
			wakeLockAutoRef.current
		) {
			toggleRef.current()
			wakeLockAutoRef.current = false
		}
	}, [timer.status, wakeLock.isActive])

	const isActive = timer.status !== 'idle'

	return (
		<div className="fixed right-4 bottom-20 z-50 md:right-6 md:bottom-6 print:hidden">
			{isExpanded ? (
				<div className="bg-card w-72 rounded-2xl border p-4 shadow-lg">
					{/* Header */}
					<div className="mb-3 flex items-center justify-between">
						<span className="text-sm font-semibold">Cooking Timer</span>
						<button
							onClick={() => setIsExpanded(false)}
							className="text-muted-foreground hover:text-foreground rounded-md p-1"
							aria-label="Collapse timer"
						>
							<Icon name="cross-1" size="sm" />
						</button>
					</div>

					{/* Time display */}
					<div
						className={cn(
							'mb-4 text-center font-mono text-4xl font-bold tabular-nums',
							timer.status === 'alarming' && 'animate-pulse text-red-500',
						)}
					>
						{isActive
							? formatTime(timer.remainingSeconds)
							: formatTime(customMinutes * 60)}
					</div>

					{timer.status === 'idle' && (
						<>
							{/* Presets */}
							<div className="mb-3 flex gap-1.5">
								{PRESETS.map((min) => (
									<Button
										key={min}
										variant="outline"
										size="sm"
										className="h-10 flex-1 px-0"
										onClick={() => timer.start(min * 60)}
									>
										{min}m
									</Button>
								))}
							</div>

							{/* Custom stepper */}
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									className="h-12 w-12 p-0 text-lg"
									onClick={() => setCustomMinutes((m) => Math.max(1, m - 1))}
								>
									−
								</Button>
								<span className="flex-1 text-center text-lg font-medium tabular-nums">
									{customMinutes} min
								</span>
								<Button
									variant="outline"
									className="h-12 w-12 p-0 text-lg"
									onClick={() => setCustomMinutes((m) => Math.min(180, m + 1))}
								>
									+
								</Button>
							</div>
							<Button
								className="mt-3 h-12 w-full text-base"
								onClick={() => timer.start(customMinutes * 60)}
							>
								<Icon name="play" size="md" />
								Start
							</Button>
						</>
					)}

					{timer.status === 'running' && (
						<div className="flex gap-2">
							<Button
								variant="outline"
								className="h-12 flex-1 text-base"
								onClick={timer.pause}
							>
								<Icon name="pause" size="md" />
								Pause
							</Button>
							<Button
								variant="outline"
								className="h-12 flex-1 text-base"
								onClick={timer.reset}
							>
								<Icon name="reset" size="md" />
								Reset
							</Button>
						</div>
					)}

					{timer.status === 'paused' && (
						<div className="flex gap-2">
							<Button className="h-12 flex-1 text-base" onClick={timer.resume}>
								<Icon name="play" size="md" />
								Resume
							</Button>
							<Button
								variant="outline"
								className="h-12 flex-1 text-base"
								onClick={timer.reset}
							>
								<Icon name="reset" size="md" />
								Reset
							</Button>
						</div>
					)}

					{timer.status === 'alarming' && (
						<Button
							variant="destructive"
							className="h-12 w-full text-base"
							onClick={timer.reset}
						>
							Dismiss
						</Button>
					)}
				</div>
			) : (
				<button
					onClick={() => setIsExpanded(true)}
					className={cn(
						'bg-primary text-primary-foreground flex h-14 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105',
						isActive ? 'min-w-[5rem] gap-2 px-4' : 'w-14',
						timer.status === 'alarming' && 'animate-pulse bg-red-500',
					)}
					aria-label={
						isActive
							? `Timer: ${formatTime(timer.remainingSeconds)}`
							: 'Open cooking timer'
					}
				>
					<Icon name="timer" size="md" />
					{isActive && (
						<span className="font-mono text-sm font-bold tabular-nums">
							{formatTime(timer.remainingSeconds)}
						</span>
					)}
				</button>
			)}
		</div>
	)
}
