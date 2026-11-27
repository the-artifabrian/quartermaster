import { type ComponentProps } from 'react'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'

/**
 * The 24px round check a Shopping row and an ingredient row on a phone draw.
 * Checked, it fills green and its tick draws at once. It only shows the
 * state: the row around it is the control.
 */
export function CheckCircle({
	checked,
	className,
	...props
}: Omit<ComponentProps<'div'>, 'children'> & { checked: boolean }) {
	return (
		<div
			{...props}
			className={cn(
				'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-[scale,background-color,border-color] duration-150 ease-(--ease-micro)',
				checked ? 'border-primary-fill bg-primary-fill' : 'border-control-edge',
				className,
			)}
		>
			<Icon
				name="check"
				size="xs"
				className={cn(
					'text-primary-foreground transition-[clip-path] duration-150 ease-(--ease-micro)',
					checked ? '[clip-path:inset(0)]' : '[clip-path:inset(0_100%_0_0)]',
				)}
			/>
		</div>
	)
}
