import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '#app/utils/misc.tsx'

const buttonVariants = cva(
	'ring-ring ring-offset-background inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ring-offset-2 outline-hidden transition-[scale,background-color,border-color,color,opacity] duration-150 focus-within:ring-2 focus-visible:ring-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				default:
					'bg-primary-fill text-primary-foreground hover:bg-primary-fill/80',
				destructive:
					'bg-destructive text-destructive-foreground hover:bg-destructive/90',
				outline: 'border-input bg-background hover:bg-muted border',
				secondary:
					'bg-secondary text-secondary-foreground hover:bg-secondary/80',
				ghost: 'hover:bg-muted',
				link: 'text-primary underline-offset-4 hover:underline',
			},
			size: {
				// A full-size button's label is 16px on a phone. `sm` stays 14px,
				// and `wide`, `pill` and `icon` take no size of their own.
				default: 'phone:text-base h-11 px-4 py-2',
				wide: 'px-24 py-5',
				// Compact only with a mouse on a wide screen (`desktop:`); a
				// finger, on any screen size, still gets a 44px target.
				sm: 'desktop:h-9 h-11 rounded-md px-3',
				lg: 'phone:text-base h-11 rounded-md px-8',
				pill: 'px-12 py-3 leading-3',
				icon: 'size-11',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
)

export type ButtonVariant = VariantProps<typeof buttonVariants>

const Button = ({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ComponentProps<'button'> &
	ButtonVariant & {
		asChild?: boolean
	}) => {
	const Comp = asChild ? Slot : 'button'
	return (
		<Comp
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	)
}

export { Button, buttonVariants }
