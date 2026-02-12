import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react'

export type TimerStatus = 'idle' | 'running' | 'paused' | 'alarming'

export type Timer = {
	id: string
	label: string
	durationSeconds: number
	endTime: number | null // absolute ms when running
	remainingMs: number // stored when paused/idle
	status: TimerStatus
}

type TimerContextValue = {
	timers: Timer[]
	addTimer: (label: string, durationSeconds: number) => void
	pauseTimer: (id: string) => void
	resumeTimer: (id: string) => void
	resetTimer: (id: string) => void
	removeTimer: (id: string) => void
	dismissAlarm: (id: string) => void
}

const TimerContext = createContext<TimerContextValue | null>(null)

const MAX_TIMERS = 5
const STORAGE_KEY = 'qm-timers'
const TICK_INTERVAL = 250

function generateId(): string {
	return Math.random().toString(36).slice(2, 9)
}

export function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60
	if (h > 0) {
		return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
	}
	return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function playAlarmSound() {
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

function loadTimersFromStorage(): Timer[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return []
		const timers = JSON.parse(raw) as Timer[]
		const now = Date.now()
		// Adjust running timers for elapsed time while away
		return timers.map((timer) => {
			if (timer.status === 'running' && timer.endTime) {
				if (timer.endTime <= now) {
					// Timer expired while away
					return { ...timer, status: 'alarming' as const, endTime: null, remainingMs: 0 }
				}
				// Still running, keep endTime as-is
				return timer
			}
			return timer
		})
	} catch {
		return []
	}
}

function saveTimersToStorage(timers: Timer[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
	} catch {
		// Storage full or unavailable
	}
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
	const [timers, setTimers] = useState<Timer[]>([])
	const [, setTick] = useState(0)
	const timersRef = useRef(timers)
	timersRef.current = timers
	const wakeLockRef = useRef<WakeLockSentinel | null>(null)
	const initializedRef = useRef(false)

	// Load from localStorage on mount (client only)
	useEffect(() => {
		const loaded = loadTimersFromStorage()
		if (loaded.length > 0) {
			setTimers(loaded)
			// Play alarm for any timers that expired while away
			if (loaded.some((t) => t.status === 'alarming')) {
				playAlarmSound()
			}
		}
		initializedRef.current = true
	}, [])

	// Save to localStorage on every change (skip until initialized)
	useEffect(() => {
		if (!initializedRef.current) return
		if (timers.length > 0) {
			saveTimersToStorage(timers)
		} else {
			try {
				localStorage.removeItem(STORAGE_KEY)
			} catch {
				// ignore
			}
		}
	}, [timers])

	// Single tick interval for all timers
	useEffect(() => {
		const id = setInterval(() => {
			const current = timersRef.current
			const now = Date.now()
			let needsUpdate = false

			for (const timer of current) {
				if (timer.status === 'running' && timer.endTime && timer.endTime <= now) {
					needsUpdate = true
					break
				}
			}

			if (needsUpdate) {
				setTimers((prev) =>
					prev.map((timer) => {
						if (
							timer.status === 'running' &&
							timer.endTime &&
							timer.endTime <= now
						) {
							return {
								...timer,
								status: 'alarming' as const,
								endTime: null,
								remainingMs: 0,
							}
						}
						return timer
					}),
				)
				playAlarmSound()
			}

			// Force re-render to update countdown displays
			setTick((t) => t + 1)
		}, TICK_INTERVAL)

		return () => clearInterval(id)
	}, [])

	// Wake lock management: request when any timer is running
	useEffect(() => {
		const hasRunning = timers.some((t) => t.status === 'running')

		async function manageWakeLock() {
			if (hasRunning && !wakeLockRef.current) {
				try {
					if ('wakeLock' in navigator) {
						wakeLockRef.current = await navigator.wakeLock.request('screen')
					}
				} catch {
					// Wake Lock request failed
				}
			} else if (!hasRunning && wakeLockRef.current) {
				try {
					await wakeLockRef.current.release()
				} catch {
					// ignore
				}
				wakeLockRef.current = null
			}
		}

		void manageWakeLock()

		function handleVisibilityChange() {
			if (document.visibilityState === 'visible' && hasRunning) {
				void manageWakeLock()
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
		}
	}, [timers])

	const addTimer = useCallback((label: string, durationSeconds: number) => {
		setTimers((prev) => {
			if (prev.length >= MAX_TIMERS) return prev
			const newTimer: Timer = {
				id: generateId(),
				label,
				durationSeconds,
				endTime: Date.now() + durationSeconds * 1000,
				remainingMs: durationSeconds * 1000,
				status: 'running',
			}
			return [...prev, newTimer]
		})
	}, [])

	const pauseTimer = useCallback((id: string) => {
		setTimers((prev) =>
			prev.map((timer) => {
				if (timer.id !== id || timer.status !== 'running') return timer
				const remaining = timer.endTime
					? Math.max(0, timer.endTime - Date.now())
					: timer.remainingMs
				return {
					...timer,
					status: 'paused' as const,
					endTime: null,
					remainingMs: remaining,
				}
			}),
		)
	}, [])

	const resumeTimer = useCallback((id: string) => {
		setTimers((prev) =>
			prev.map((timer) => {
				if (timer.id !== id || timer.status !== 'paused') return timer
				return {
					...timer,
					status: 'running' as const,
					endTime: Date.now() + timer.remainingMs,
				}
			}),
		)
	}, [])

	const resetTimer = useCallback((id: string) => {
		setTimers((prev) =>
			prev.map((timer) => {
				if (timer.id !== id) return timer
				return {
					...timer,
					status: 'idle' as const,
					endTime: null,
					remainingMs: timer.durationSeconds * 1000,
				}
			}),
		)
	}, [])

	const removeTimer = useCallback((id: string) => {
		setTimers((prev) => prev.filter((timer) => timer.id !== id))
	}, [])

	const dismissAlarm = useCallback((id: string) => {
		setTimers((prev) => prev.filter((timer) => timer.id !== id))
	}, [])

	return (
		<TimerContext.Provider
			value={{
				timers,
				addTimer,
				pauseTimer,
				resumeTimer,
				resetTimer,
				removeTimer,
				dismissAlarm,
			}}
		>
			{children}
		</TimerContext.Provider>
	)
}

export function useTimers(): TimerContextValue {
	const ctx = useContext(TimerContext)
	if (!ctx) {
		throw new Error('useTimers must be used within a TimerProvider')
	}
	return ctx
}

/**
 * Get the remaining seconds for a timer, computed from endTime for running timers.
 */
export function getTimerRemainingSeconds(timer: Timer): number {
	if (timer.status === 'running' && timer.endTime) {
		return Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000))
	}
	return Math.max(0, Math.ceil(timer.remainingMs / 1000))
}
