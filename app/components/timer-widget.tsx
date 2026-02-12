import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import {
	useTimers,
	getTimerRemainingSeconds,
	formatTime,
} from '#app/utils/timer-context.tsx'

const PRESETS = [1, 5, 10, 15, 30] as const

export function TimerWidget() {
	const { timers, addTimer, pauseTimer, resumeTimer, removeTimer, dismissAlarm } =
		useTimers()
	const [isExpanded, setIsExpanded] = useState(false)

	const activeTimers = timers.filter((t) => t.status !== 'idle')
	const hasAlarming = timers.some((t) => t.status === 'alarming')

	// Nothing to show if no timers
	if (activeTimers.length === 0 && !isExpanded) return null

	// Find the timer with shortest remaining time for collapsed display
	const runningTimers = activeTimers.filter((t) => t.status === 'running')
	const shortestRunning = runningTimers.length > 0
		? runningTimers.reduce((shortest, t) => {
				const remaining = getTimerRemainingSeconds(t)
				const shortestRemaining = getTimerRemainingSeconds(shortest)
				return remaining < shortestRemaining ? t : shortest
			})
		: null
	const displayTimer = hasAlarming
		? timers.find((t) => t.status === 'alarming')!
		: shortestRunning ?? activeTimers[0]

	if (!isExpanded) {
		return (
			<button
				onClick={() => setIsExpanded(true)}
				className={cn(
					'fixed right-4 bottom-20 z-50 flex items-center gap-2 rounded-full px-4 shadow-lg transition-all hover:scale-105 md:right-6 md:bottom-6 print:hidden',
					hasAlarming
						? 'h-14 animate-pulse bg-red-500 text-white'
						: 'bg-primary text-primary-foreground h-14',
				)}
				aria-label={
					displayTimer
						? `Timer: ${formatTime(getTimerRemainingSeconds(displayTimer))}`
						: 'Open timers'
				}
			>
				<Icon name="timer" size="md" />
				{displayTimer && (
					<span className="font-mono text-sm font-bold tabular-nums">
						{formatTime(getTimerRemainingSeconds(displayTimer))}
					</span>
				)}
				{activeTimers.length > 1 && (
					<span className="bg-background/20 rounded-full px-1.5 py-0.5 text-xs font-bold">
						+{activeTimers.length - 1}
					</span>
				)}
			</button>
		)
	}

	return (
		<div className="fixed right-4 bottom-20 z-50 md:right-6 md:bottom-6 print:hidden">
			<div className="bg-card w-80 rounded-2xl border p-4 shadow-warm-lg">
				{/* Header */}
				<div className="mb-3 flex items-center justify-between">
					<span className="text-sm font-semibold">Timers</span>
					<button
						onClick={() => setIsExpanded(false)}
						className="text-muted-foreground hover:text-foreground rounded-md p-1"
						aria-label="Collapse timers"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{/* Timer list */}
				{activeTimers.length > 0 && (
					<div className="mb-3 space-y-2">
						{activeTimers.map((timer) => {
							const remaining = getTimerRemainingSeconds(timer)
							const isAlarming = timer.status === 'alarming'
							const isRunning = timer.status === 'running'
							const isPaused = timer.status === 'paused'

							return (
								<div
									key={timer.id}
									className={cn(
										'flex items-center gap-2 rounded-lg px-3 py-2',
										isAlarming
											? 'animate-pulse bg-red-100 dark:bg-red-900/30'
											: 'bg-muted/50',
									)}
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-xs text-muted-foreground">
											{timer.label}
										</p>
										<p
											className={cn(
												'font-mono text-lg font-bold tabular-nums',
												isAlarming && 'text-red-500',
											)}
										>
											{formatTime(remaining)}
										</p>
									</div>
									<div className="flex gap-1">
										{isRunning && (
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0"
												onClick={() => pauseTimer(timer.id)}
												aria-label="Pause timer"
											>
												<Icon name="pause" size="sm" />
											</Button>
										)}
										{isPaused && (
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0"
												onClick={() => resumeTimer(timer.id)}
												aria-label="Resume timer"
											>
												<Icon name="play" size="sm" />
											</Button>
										)}
										{isAlarming ? (
											<Button
												variant="destructive"
												size="sm"
												className="h-8 px-2"
												onClick={() => dismissAlarm(timer.id)}
											>
												Dismiss
											</Button>
										) : (
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0"
												onClick={() => removeTimer(timer.id)}
												aria-label="Remove timer"
											>
												<Icon name="cross-1" size="sm" />
											</Button>
										)}
									</div>
								</div>
							)
						})}
					</div>
				)}

				{/* Add Timer presets */}
				<div>
					<p className="text-muted-foreground mb-2 text-xs font-medium">
						Quick Timer
					</p>
					<div className="flex gap-1.5">
						{PRESETS.map((min) => (
							<Button
								key={min}
								variant="outline"
								size="sm"
								className="h-9 flex-1 px-0"
								disabled={timers.length >= MAX_TIMERS_DISPLAY}
								onClick={() => addTimer(`${min} min timer`, min * 60)}
							>
								{min}m
							</Button>
						))}
					</div>
					{timers.length >= MAX_TIMERS_DISPLAY && (
						<p className="text-muted-foreground mt-1 text-center text-xs">
							Maximum 5 timers reached
						</p>
					)}
				</div>
			</div>
		</div>
	)
}

const MAX_TIMERS_DISPLAY = 5
