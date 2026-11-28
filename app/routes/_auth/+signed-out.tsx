import { cn } from '#app/utils/misc.tsx'

// What the signed-out forms (Log in, Sign up, Forgot password, the code
// screens, Reset password and Set up your account) share on a phone. The
// classes are behind `phone:`, so wider screens keep each screen's own layout;
// the title's serif and its 24px are the one exception, as they are every
// screen's own title look from 768px.

/** The page: 32px above the title and 96px under the form. */
export const signedOutPageClass = 'phone:pt-8 phone:pb-24'

/**
 * One column for the title and the form: the page gutter, 448px at most. No
 * min-width, so a form that is full width from 768px stops at 448px too.
 */
export const signedOutColumnClass =
	'phone:mx-auto phone:w-full phone:max-w-md phone:min-w-0'

/** The title's block and any text that follows its alignment. */
export const signedOutAlignClass = 'phone:text-left'

/** A row that starts where the title does. */
export const signedOutJustifyClass = 'phone:justify-start'

/**
 * The paragraph under the title. Each screen sets the 8px between them, as a
 * margin or as its title block's gap.
 */
export const signedOutLeadClass = 'phone:text-base'

/** A paragraph that is the one thing to read on its screen. */
export const signedOutLeadInkClass =
	'phone:text-item-name phone:text-foreground'

/** A second, smaller line under the paragraph. */
export const signedOutSmallClass = 'phone:text-label phone:mt-1'

/** From the paragraph to the first field. */
export const signedOutGapClass = 'phone:mt-6'

/** A screen's main action: 48px tall, on top of the button's full width. */
export const signedOutMainActionClass = 'phone:h-12 phone:font-semibold'

/** A link in a line of text: 16px, with a 44px tap area. */
export const signedOutLinkClass =
	'phone:inline-flex phone:min-h-11 phone:items-center phone:text-base'

/** A link on its own row under the main action, its line 24px below it. */
export const signedOutRowLinkClass =
	'phone:mt-3.5 phone:flex phone:min-h-11 phone:items-center phone:justify-center phone:text-base'

export function SignedOutTitle({
	className,
	...props
}: React.ComponentProps<'h1'>) {
	return (
		<h1
			className={cn('phone:text-edit-title font-serif text-2xl', className)}
			{...props}
		/>
	)
}
