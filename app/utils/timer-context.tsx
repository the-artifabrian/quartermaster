import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import {
	maybeRequestTimerNotificationPermission,
	showTimerDoneNotification,
} from '#app/utils/timer-notifications.ts'
import { useWakeLock } from '#app/utils/wake-lock.ts'

export type TimerStatus = 'idle' | 'running' | 'paused' | 'alarming'

export type Timer = {
	id: string
	label: string
	durationSeconds: number
	endTime: number | null // absolute ms when running
	remainingMs: number // stored when paused/idle
	status: TimerStatus
	alarmStartedAt: number | null // ms when timer first entered alarming state
}

type TimerContextValue = {
	timers: Timer[]
	now: number
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
const AUTO_DISMISS_MS = 60_000 // auto-dismiss alarming timers after 60s

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
					return {
						...timer,
						status: 'alarming' as const,
						endTime: null,
						remainingMs: 0,
						alarmStartedAt: timer.alarmStartedAt ?? timer.endTime,
					}
				}
				// Still running, keep endTime as-is
				return timer
			}
			// Backfill alarmStartedAt for alarming timers from before this field existed
			if (timer.status === 'alarming' && !timer.alarmStartedAt) {
				return { ...timer, alarmStartedAt: now }
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
	const [now, setNow] = useState(() => Date.now())
	const timersRef = useRef(timers)
	timersRef.current = timers
	const initializedRef = useRef(false)
	const hasTickingTimer = timers.some(
		(timer) => timer.status === 'running' || timer.status === 'alarming',
	)

	// Load from localStorage on mount (client only)
	useEffect(() => {
		const loaded = loadTimersFromStorage()
		if (loaded.length > 0) {
			setNow(Date.now())
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
		if (!hasTickingTimer) return

		const id = setInterval(() => {
			const current = timersRef.current
			const now = Date.now()
			setNow(now)
			let needsUpdate = false

			for (const timer of current) {
				if (
					timer.status === 'running' &&
					timer.endTime &&
					timer.endTime <= now
				) {
					needsUpdate = true
					break
				}
			}

			if (needsUpdate) {
				const finished = current.filter(
					(timer) =>
						timer.status === 'running' && timer.endTime && timer.endTime <= now,
				)
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
								alarmStartedAt: now,
							}
						}
						return timer
					}),
				)
				playAlarmSound()
				// The beep is page-bound: a backgrounded tab or app switch would
				// fail silently. Hand off to a system notification when hidden.
				if (document.visibilityState !== 'visible') {
					for (const timer of finished) {
						void showTimerDoneNotification(timer)
					}
				}
			}

			// Auto-dismiss timers that have been alarming for too long
			const hasStaleAlarms = current.some(
				(t) =>
					t.status === 'alarming' &&
					t.alarmStartedAt &&
					now - t.alarmStartedAt >= AUTO_DISMISS_MS,
			)
			if (hasStaleAlarms) {
				setTimers((prev) =>
					prev.filter(
						(t) =>
							!(
								t.status === 'alarming' &&
								t.alarmStartedAt &&
								now - t.alarmStartedAt >= AUTO_DISMISS_MS
							),
					),
				)
			}
		}, TICK_INTERVAL)

		return () => clearInterval(id)
	}, [hasTickingTimer])

	// Keep the screen awake while any timer is running (shared, refcounted
	// manager — the recipe page holds its own claim while it's open).
	useWakeLock(timers.some((t) => t.status === 'running'))

	const addTimer = useCallback((label: string, durationSeconds: number) => {
		// First timer start is a user gesture — the one moment a permission
		// prompt is justified. Declining degrades to the in-page alarm.
		maybeRequestTimerNotificationPermission()
		const startedAt = Date.now()
		setNow(startedAt)
		setTimers((prev) => {
			if (prev.length >= MAX_TIMERS) return prev
			const newTimer: Timer = {
				id: generateId(),
				label,
				durationSeconds,
				endTime: startedAt + durationSeconds * 1000,
				remainingMs: durationSeconds * 1000,
				status: 'running',
				alarmStartedAt: null,
			}
			return [...prev, newTimer]
		})
	}, [])

	const pauseTimer = useCallback((id: string) => {
		const pausedAt = Date.now()
		setNow(pausedAt)
		setTimers((prev) =>
			prev.map((timer) => {
				if (timer.id !== id || timer.status !== 'running') return timer
				const remaining = timer.endTime
					? Math.max(0, timer.endTime - pausedAt)
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
		const resumedAt = Date.now()
		setNow(resumedAt)
		setTimers((prev) =>
			prev.map((timer) => {
				if (timer.id !== id || timer.status !== 'paused') return timer
				return {
					...timer,
					status: 'running' as const,
					endTime: resumedAt + timer.remainingMs,
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
					alarmStartedAt: null,
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

	const value = useMemo<TimerContextValue>(
		() => ({
			timers,
			now,
			addTimer,
			pauseTimer,
			resumeTimer,
			resetTimer,
			removeTimer,
			dismissAlarm,
		}),
		[
			timers,
			now,
			addTimer,
			pauseTimer,
			resumeTimer,
			resetTimer,
			removeTimer,
			dismissAlarm,
		],
	)

	return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>
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
export function getTimerRemainingSeconds(
	timer: Timer,
	now: number = Date.now(),
): number {
	if (timer.status === 'running' && timer.endTime) {
		return Math.max(0, Math.ceil((timer.endTime - now) / 1000))
	}
	return Math.max(0, Math.ceil(timer.remainingMs / 1000))
}
