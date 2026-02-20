import { cn } from '#app/utils/misc.tsx'

/**
 * A hand-drawn-feeling SVG horizontal rule.
 * - `subtle`: standard section divider (1px stroke, sugi color)
 * - `accent`: slightly thicker, for recipe title underline (1.5px stroke, kawa-tinted)
 */
export function Divider({
	variant = 'subtle',
	className,
}: {
	variant?: 'subtle' | 'accent'
	className?: string
}) {
	const isAccent = variant === 'accent'
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 800 6"
			preserveAspectRatio="none"
			className={cn('h-[6px] w-full', className)}
		>
			<path
				d="M0 3 C120 1.5, 250 4.5, 400 3 S680 1.5, 800 3"
				fill="none"
				stroke={isAccent ? 'var(--accent)' : 'var(--border)'}
				strokeWidth={isAccent ? 1.5 : 1}
				strokeLinecap="round"
				opacity={isAccent ? 0.6 : 0.8}
			/>
		</svg>
	)
}
