import type * as React from 'react'

import { cn } from '#app/utils/misc.tsx'

/**
 * An on/off setting, drawn as an iOS switch: a 51×31 track whose thumb
 * slides right and whose track fills sage when on. The button around it is
 * 44px tall so a thumb finds it. Name it with `aria-label` or a `<label>`.
 */
export function Switch({
	checked,
	onCheckedChange,
	className,
	onClick,
	...props
}: Omit<React.ComponentProps<'button'>, 'role' | 'type'> & {
	checked: boolean
	onCheckedChange: (checked: boolean) => void
}) {
	return (
		<button
			data-slot="switch"
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={(event) => {
				onClick?.(event)
				if (!event.defaultPrevented) onCheckedChange(!checked)
			}}
			className={cn(
				'ring-ring ring-offset-background inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full ring-offset-2 outline-hidden focus-visible:ring-2 disabled:opacity-50',
				className,
			)}
			{...props}
		>
			<span
				aria-hidden="true"
				className={cn(
					'relative h-[31px] w-[51px] rounded-full transition-colors duration-150 ease-(--ease-micro) motion-reduce:transition-none',
					checked ? 'bg-primary' : 'bg-muted-foreground/25',
				)}
			>
				<span
					className={cn(
						'absolute top-0.5 left-0.5 size-[27px] rounded-full bg-white shadow-sm transition-transform duration-150 ease-(--ease-micro) motion-reduce:transition-none',
						checked ? 'translate-x-5' : 'translate-x-0',
					)}
				/>
			</span>
		</button>
	)
}
