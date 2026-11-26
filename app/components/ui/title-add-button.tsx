import { Slottable } from '@radix-ui/react-slot'
import { type ComponentProps } from 'react'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './button.tsx'
import { Icon } from './icon.tsx'

/**
 * The one way to add on a tab root (Recipes, Menus, Staples, Plan): a round
 * sage + to the right of the big serif page title, 44px. It needs an
 * `aria-label` that says what it adds ("New Recipe", "New Menu", "Add
 * Staple", "Add Meal to Thursday, Nov 19"). Shopping adds from the "Add an
 * item" bar docked above the tab bar instead.
 *
 * `children` show beside the + where a screen widens it (Recipes' "New
 * Recipe" from `sm`, via `className`). With `asChild` the one child is the
 * link it becomes (Menus' "New Menu"), and the + goes inside it.
 */
export function TitleAddButton({
	className,
	children,
	asChild,
	...props
}: ComponentProps<typeof Button>) {
	return (
		<Button
			type={asChild ? undefined : 'button'}
			asChild={asChild}
			className={cn('size-11 shrink-0 rounded-full p-0', className)}
			{...props}
		>
			<Icon name="plus" size="sm" />
			<Slottable>{children}</Slottable>
		</Button>
	)
}

/**
 * A tab root's big title (Recipes, Menus, Staples, Plan, Shopping, Settings):
 * the serif at 40px, weight 500, set tight.
 */
export function TabTitle({ className, ...props }: ComponentProps<'h1'>) {
	return (
		<h1
			className={cn('font-serif text-[2.5rem] leading-[1.05]', className)}
			{...props}
		/>
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
