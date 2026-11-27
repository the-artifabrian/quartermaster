import { cn } from '#app/utils/misc.tsx'
import { buttonVariants } from './ui/button.tsx'

/**
 * A Staple row's look, shared by the Staples screen (`ActiveStaples`) and
 * the homepage's picture of it (`StaplesPhone`), so the two cannot drift.
 */

/** The row: at least 56px, the name then the Need button. */
export const stapleRowClassName =
	'flex min-h-14 w-full min-w-0 items-center gap-3 py-1.5'

/** The name wraps, a long word included, rather than being cut off. */
export const stapleNameClassName =
	'text-item-name min-w-0 flex-1 font-medium wrap-anywhere md:text-base'

/**
 * Need is a quiet pill; once the Staple waits in Next shop it reads a green
 * check and "On list" with no fill. One width in both states, so a tap
 * never wraps the name again.
 */
export function stapleNeedClassName(onShoppingList: boolean) {
	return cn(
		buttonVariants({ variant: onShoppingList ? 'ghost' : 'secondary' }),
		'w-19 shrink-0 gap-1.5 rounded-full px-0 font-semibold select-none',
		onShoppingList
			? 'text-primary justify-end hover:bg-transparent'
			: 'justify-center',
	)
}
