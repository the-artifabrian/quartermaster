import { cn } from '#app/utils/misc.tsx'
import { buttonVariants } from './ui/button.tsx'

/**
 * A Staple row's look, shared by the Staples screen (`ActiveStaples`) and
 * the homepage's picture of it (`StaplesPhone`), so the two cannot drift.
 */

/** How far a swiped row slides to uncover Delete (px), as on Shopping. */
export const STAPLE_SWIPE_WIDTH = 76

/** The row: at least 56px, the name then the Need button. */
export const stapleRowClassName =
	'flex min-h-14 w-full min-w-0 items-center gap-3 py-1.5'

/** The name wraps, a long word included, rather than being cut off. */
export const stapleNameClassName =
	'text-item-name min-w-0 flex-1 font-medium wrap-anywhere'

/**
 * Need is a quiet pill; once the Staple waits in Next shop it reads a green
 * check and "On list" with no fill. One width in both states, so a tap
 * never wraps the name again. The ring shows for the keyboard only, not
 * after a tap.
 */
export function stapleNeedClassName(onShoppingList: boolean) {
	return cn(
		buttonVariants({ variant: onShoppingList ? 'ghost' : 'secondary' }),
		'phone:text-sm w-19 shrink-0 gap-1.5 rounded-full px-0 font-semibold select-none focus-within:ring-0 focus-within:ring-offset-0 focus-visible:ring-offset-2',
		onShoppingList
			? 'text-primary justify-end hover:bg-transparent'
			: 'justify-center',
	)
}
