import { useSpinDelay } from 'spin-delay'
import { cn } from '#app/utils/misc.tsx'
import { Button, type ButtonVariant } from './button.tsx'
import { Icon } from './icon.tsx'

export function PendingButton({
	pending,
	pendingLabel,
	className,
	children,
	disabled,
	...props
}: React.ComponentProps<'button'> &
	ButtonVariant & {
		pending: boolean
		pendingLabel: string
	}) {
	const delayedPending = useSpinDelay(pending, {
		delay: 400,
		minDuration: 300,
	})

	return (
		<span className="relative inline-flex">
			<Button
				className={className}
				disabled={pending || disabled}
				aria-busy={pending || undefined}
				{...props}
			>
				<span
					className={cn(
						'inline-flex items-center justify-center gap-2',
						delayedPending && 'opacity-0',
					)}
				>
					{children}
				</span>
			</Button>
			{delayedPending ? (
				<span
					role="status"
					className="pointer-events-none absolute inset-0 inline-flex items-center justify-center"
				>
					<Icon name="update" className="animate-spin" aria-hidden />
					<span className="sr-only">{pendingLabel}</span>
				</span>
			) : null}
		</span>
	)
}
