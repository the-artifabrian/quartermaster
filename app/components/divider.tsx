import { cn } from '#app/utils/misc.tsx'

/**
 * Clean horizontal rule.
 * - `subtle`: standard section divider (1px, cedar/border color)
 * - `accent`: copper-tinted (1px, accent color at 40% opacity)
 */
export function Divider({
	variant = 'subtle',
	className,
}: {
	variant?: 'subtle' | 'accent'
	className?: string
}) {
	return (
		<hr
			className={cn(
				'border-t',
				variant === 'accent' ? 'border-accent/40' : 'border-border',
				className,
			)}
		/>
	)
}
