import { useState, useCallback } from 'react'
import { Icon } from '#app/components/ui/icon.tsx'
import { useTimers } from '#app/utils/timer-context.tsx'

export function InlineTimerButton({
	durationSeconds,
	label,
	stepNumber,
	recipeName,
}: {
	durationSeconds: number
	label: string
	stepNumber: number
	recipeName: string
}) {
	const { timers, addTimer } = useTimers()
	const [justStarted, setJustStarted] = useState(false)
	const atMax = timers.length >= 5

	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (atMax) return
			const timerLabel = `Step ${stepNumber} – ${label}`
			addTimer(
				recipeName ? `${recipeName}: ${timerLabel}` : timerLabel,
				durationSeconds,
			)
			setJustStarted(true)
			setTimeout(() => setJustStarted(false), 1500)
		},
		[addTimer, atMax, durationSeconds, label, recipeName, stepNumber],
	)

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={atMax}
			className="bg-accent/10 text-accent hover:bg-accent/20 mx-0.5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40"
		>
			<Icon name="timer" className="size-3.5" />
			{justStarted ? 'Started!' : label}
		</button>
	)
}
