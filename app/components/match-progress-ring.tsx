import { cn } from '#app/utils/misc.tsx'

const CIRCUMFERENCE = 2 * Math.PI * 16 // radius 16, ~100.53

function getColorClass(percentage: number) {
	if (percentage >= 80) return 'text-green-500 dark:text-green-400'
	if (percentage >= 50) return 'text-amber-500 dark:text-amber-400'
	return 'text-muted-foreground/60'
}

export function MatchProgressRing({
	percentage,
	size = 40,
	className,
}: {
	percentage: number
	size?: number
	className?: string
}) {
	const offset = CIRCUMFERENCE * (1 - percentage / 100)

	return (
		<div
			role="img"
			aria-label={`${percentage}% match`}
			className={cn('relative flex items-center justify-center', className)}
			style={{ width: size, height: size }}
		>
			<svg viewBox="0 0 40 40" className="h-full w-full -rotate-90" fill="none">
				{/* Background track */}
				<circle
					cx="20"
					cy="20"
					r="16"
					strokeWidth="2.5"
					className="stroke-muted"
				/>
				{/* Filled arc */}
				<circle
					cx="20"
					cy="20"
					r="16"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={offset}
					className={cn(
						'transition-[stroke-dashoffset] duration-500',
						getColorClass(percentage),
					)}
					stroke="currentColor"
				/>
			</svg>
			<span
				className="absolute text-center leading-none font-bold"
				style={{ fontSize: size * 0.28 }}
			>
				{percentage}
			</span>
		</div>
	)
}
