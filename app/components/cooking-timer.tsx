import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { useTimers } from '#app/utils/timer-context.tsx'

const PRESETS = [1, 5, 10, 15, 30] as const

export function CookingTimer({ recipeName }: { recipeName?: string }) {
	const { timers, addTimer } = useTimers()
	const [customMinutes, setCustomMinutes] = useState(10)

	const atMax = timers.length >= 5

	function startTimer(minutes: number) {
		const label = recipeName
			? `${recipeName} – ${minutes}m`
			: `${minutes} min timer`
		addTimer(label, minutes * 60)
	}

	return (
		<div className="bg-card mt-4 rounded-2xl border p-4 print:hidden">
			<div className="mb-3 flex items-center gap-2">
				<Icon name="timer" size="sm" className="text-accent" />
				<span className="text-sm font-semibold">Set Timer</span>
			</div>

			{/* Presets */}
			<div className="mb-3 flex gap-1.5">
				{PRESETS.map((min) => (
					<Button
						key={min}
						variant="outline"
						size="sm"
						className="h-10 flex-1 px-0"
						disabled={atMax}
						onClick={() => startTimer(min)}
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
				disabled={atMax}
				onClick={() => startTimer(customMinutes)}
			>
				<Icon name="play" size="md" />
				Start Timer
			</Button>
			{atMax && (
				<p className="text-muted-foreground mt-1 text-center text-xs">
					Maximum 5 timers reached
				</p>
			)}
		</div>
	)
}
