import { useSpinDelay } from 'spin-delay'
import { cn } from '#app/utils/misc.tsx'
import { Button, type ButtonVariant } from './button.tsx'
import { Icon } from './icon.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from './tooltip.tsx'

export const StatusButton = ({
	message,
	status,
	className,
	children,
	spinDelay,
	...props
}: React.ComponentProps<'button'> &
	ButtonVariant & {
		status: 'pending' | 'success' | 'error' | 'idle'
		message?: string | null
		spinDelay?: Parameters<typeof useSpinDelay>[1]
	}) => {
	const delayedPending = useSpinDelay(status === 'pending', {
		delay: 400,
		minDuration: 300,
		...spinDelay,
	})
	const companion = {
		pending: delayedPending ? (
			<div
				role="status"
				className="inline-flex size-6 items-center justify-center"
			>
				<Icon name="update" className="size-3.5 animate-spin" title="loading" />
			</div>
		) : null,
		success: (
			<div
				role="status"
				className="inline-flex size-6 items-center justify-center"
			>
				<Icon name="check" className="size-3.5" title="success" />
			</div>
		),
		error: (
			<div
				role="status"
				className="bg-destructive inline-flex size-6 items-center justify-center rounded-full"
			>
				<Icon
					name="cross-1"
					className="text-destructive-foreground size-3.5"
					title="error"
				/>
			</div>
		),
		idle: null,
	}[status]

	return (
		<Button className={cn('flex justify-center gap-4', className)} {...props}>
			<div>{children}</div>
			{message ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger>{companion}</TooltipTrigger>
						<TooltipContent>{message}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : (
				companion
			)}
		</Button>
	)
}
StatusButton.displayName = 'Button'
