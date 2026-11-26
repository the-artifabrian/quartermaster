import type * as React from 'react'

import { cn } from '#app/utils/misc.tsx'
import { Icon, type IconName } from './icon.tsx'

/**
 * The app's one chip: a rounded, 44px-tall button for picking a value (a day,
 * a label, a Season) or for a one-tap suggestion.
 *
 * Pass `pressed` for a toggle: it sets `aria-pressed` and fills the chip with
 * green while on, or with `tone="tint"` tints it and rings it in green (the
 * Recipes list's filters). Leave it out for a plain action chip, such as
 * "+ Salt".
 */
export function Chip({
	pressed,
	tone,
	icon,
	type = 'button',
	className,
	children,
	...props
}: React.ComponentProps<'button'> & {
	pressed?: boolean
	tone?: ChipTone
	/** A leading icon, as in a "+ Salt" suggestion. */
	icon?: IconName
}) {
	return (
		<button
			data-slot="chip"
			type={type}
			aria-pressed={pressed}
			className={cn(chipClassName(pressed, tone), className)}
			{...props}
		>
			{icon ? <Icon name={icon} size="sm" className="shrink-0" /> : null}
			{children}
		</button>
	)
}

/** How a chip shows it is on: a green fill, or the tint with a green ring. */
type ChipTone = 'fill' | 'tint'

/**
 * The chip's look, for a control that has to stay its own element (a native
 * `<select>` in a row of chips) or a menu trigger that is "on" without being
 * a toggle.
 */
export function chipClassName(on?: boolean, tone: ChipTone = 'fill') {
	return cn(
		'ring-ring ring-offset-background inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm ring-offset-2 outline-hidden transition-[scale,background-color,border-color,color,opacity] duration-150 ease-(--ease-micro) focus-visible:ring-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
		!on
			? 'border-border bg-background text-foreground hover:bg-muted'
			: tone === 'tint'
				? 'border-primary bg-primary-tint text-primary inset-ring-primary inset-ring-[0.5px]'
				: 'border-primary-fill bg-primary-fill text-primary-foreground',
	)
}
