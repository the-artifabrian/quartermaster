import { type ReactNode } from 'react'
import { cn } from '#app/utils/misc.tsx'

/**
 * A picture of one of the app's phone screens in a phone drawn in CSS, for
 * the homepage. The screen is laid out at a phone's width, 390 by 844, at the
 * app's own sizes, and scaled down as a whole, so at the default text size it
 * never reflows: the slot it sits in takes the scaled size, and
 * `--phone-scale` steps with the page's breakpoints so the phone fits its
 * column from a 320px page up.
 *
 * It is one image to a screen reader, named by `label`, or none at all when
 * `decorative` (a phone that repeats one shown elsewhere). Nothing inside
 * takes focus or a tap.
 */
export function PhoneFrame({
	label,
	scale,
	decorative = false,
	className,
	children,
}: {
	label: string
	/** The `--phone-scale` steps, from `phoneScales`; null takes the value an
	 *  ancestor sets, as a group of phones sized together does. */
	scale: string | null
	decorative?: boolean
	className?: string
	children: ReactNode
}) {
	return (
		<div
			data-phone-frame=""
			role={decorative ? undefined : 'img'}
			aria-label={decorative ? undefined : label}
			aria-hidden={decorative ? true : undefined}
			className={cn('w-fit', scale, className)}
		>
			<div
				aria-hidden="true"
				inert
				className="border-border bg-card shadow-warm-lg rounded-[calc(var(--phone-scale)*3.25rem_+_6px)] border p-[5px] select-none"
			>
				<div
					data-phone-slot=""
					className="bg-background relative h-[calc(var(--phone-scale)*844px)] w-[calc(var(--phone-scale)*390px)] overflow-hidden rounded-[calc(var(--phone-scale)*3.25rem)]"
				>
					<div
						data-phone-screen=""
						className="text-foreground absolute top-0 left-0 flex h-[844px] w-[390px] origin-top-left scale-(--phone-scale) flex-col text-left"
					>
						{/* The status bar's band and the home indicator's, left empty,
						    keep the screen clear of the rounded corners. The tab bar
						    is left out: the section beside each phone names its tab,
						    and the room goes to the screen itself. */}
						<div className="h-10 shrink-0" />
						<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
							{children}
						</div>
						<div className="h-5 shrink-0" />
					</div>
				</div>
			</div>
		</div>
	)
}

/**
 * The scale steps for each place a phone sits, one per width, so the phone
 * fills its column without overflowing it. Every step is a `min-[…]` width:
 * Tailwind puts those before its named breakpoints, so a set that mixed the
 * two would let `lg:` beat a wider `min-[1280px]:` step.
 */
export const phoneScales = {
	/** Above its text: one column, two from 640px, four from 1280px. */
	step: '[--phone-scale:0.7] min-[360px]:[--phone-scale:0.78] min-[640px]:[--phone-scale:0.67] min-[768px]:[--phone-scale:0.84] min-[1024px]:[--phone-scale:0.86] min-[1280px]:[--phone-scale:0.7] min-[1400px]:[--phone-scale:0.77]',
	/** The hero's pair, set on the pair, which sizes itself by it: the Plan
	 *  alone below 640px, then the two. */
	pair: '[--phone-scale:0.7] min-[360px]:[--phone-scale:0.78] min-[640px]:[--phone-scale:0.85] min-[1024px]:[--phone-scale:0.72] min-[1280px]:[--phone-scale:0.8]',
}
