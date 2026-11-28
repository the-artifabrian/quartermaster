import { cn } from '#app/utils/misc.tsx'

// What the signed-out forms (Log in, Sign up, Forgot password, the code
// screens, Reset password and Set up your account) share on a phone. Every
// class here is behind `phone:`, so wider screens keep each screen's own
// layout.

/**
 * The page: 32px above the title and 96px under the form. A title reads from
 * the left edge; `title-centred` beside this class centres it, with its
 * paragraph and the code field, and sets it a size up.
 */
export const signedOutPageClass = 'group/out phone:pt-8 phone:pb-24'

/** One column for the title and the form: the page gutter, 448px at most. */
export const signedOutColumnClass = 'phone:mx-auto phone:w-full phone:max-w-md'

/** The title's block and any text that follows its alignment. */
export const signedOutAlignClass =
	'phone:text-left phone:group-[.title-centred]/out:text-center'

/** A row that starts where the title does. */
export const signedOutJustifyClass =
	'phone:justify-start phone:group-[.title-centred]/out:justify-center'

/** The paragraph under the title, 8px below it. */
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

/** A link on its own row under the main action, 24px below it. */
export const signedOutRowLinkClass =
	'phone:mt-3.5 phone:flex phone:min-h-11 phone:items-center phone:justify-center phone:text-base'

export function SignedOutTitle({
	className,
	...props
}: React.ComponentProps<'h1'>) {
	return (
		<h1
			className={cn(
				'phone:text-edit-title phone:group-[.title-centred]/out:text-menu-title font-serif text-2xl',
				className,
			)}
			{...props}
		/>
	)
}
