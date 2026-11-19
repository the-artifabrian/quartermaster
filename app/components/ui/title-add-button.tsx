import { type ComponentProps } from 'react'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './button.tsx'
import { Icon } from './icon.tsx'

/**
 * The one way to add on a tab root (Recipes, Staples, Plan): a round sage +
 * to the right of the big serif page title, 44px. It needs an `aria-label`
 * that says what it adds ("New Recipe", "Add Staple", "Add Meal to Thursday,
 * Nov 19"). Shopping keeps its floating + instead.
 *
 * `children` show beside the + where a screen widens it (Recipes' "New
 * Recipe" from `sm`, via `className`).
 */
export function TitleAddButton({
	className,
	children,
	...props
}: ComponentProps<typeof Button>) {
	return (
		<Button
			type="button"
			className={cn('size-11 shrink-0 rounded-full p-0', className)}
			{...props}
		>
			<Icon name="plus" size="sm" />
			{children}
		</Button>
	)
}

/** The row a tab root's title and its + share. */
export function TitleRow({ className, ...props }: ComponentProps<'div'>) {
	return (
		<div
			className={cn('flex items-center justify-between gap-3', className)}
			{...props}
		/>
	)
}
