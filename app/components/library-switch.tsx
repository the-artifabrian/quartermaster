import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { SegmentedLinks } from './ui/segmented-control.tsx'
import { TabTitle } from './ui/title-add-button.tsx'

type Library = 'recipes' | 'menus'

const PATHS = { recipes: '/recipes', menus: '/recipes/menus' } as const

// History entries this switch has already arrived on, so Back to one (or a
// reload, which keeps its state) does not slide the pill again.
const seenEntries = new Set<string>()
// False until a switch has mounted in this document. The first one may be the
// hydration render, which has to match the server's (no slide), and a
// switch's state only means "just switched" once one has been on screen.
let switchMounted = false

/**
 * List-local switch between the Recipes and Menus libraries. Both live in the
 * global Recipes destination, so this is a pair of route links, not a tab
 * system. Wider screens show it under the title; a phone uses LibraryTitle.
 */
export function LibrarySwitch({
	active,
	className,
}: {
	active: Library
	className?: string
}) {
	const location = useLocation()
	const state = location.state as { librarySwitchFrom?: Library } | null
	const from =
		switchMounted && state?.librarySwitchFrom && !seenEntries.has(location.key)
			? PATHS[state.librarySwitchFrom]
			: undefined
	useEffect(() => {
		switchMounted = true
		if (state?.librarySwitchFrom) seenEntries.add(location.key)
		// Only the arrival counts; later renders of this entry don't slide.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])
	return (
		<SegmentedLinks
			aria-label="Library"
			links={[
				{
					to: PATHS.recipes,
					label: 'Recipes',
					viewTransition: true,
					state: { librarySwitchFrom: active },
				},
				{
					to: PATHS.menus,
					label: 'Menus',
					viewTransition: true,
					state: { librarySwitchFrom: active },
				},
			]}
			current={PATHS[active]}
			slideFrom={from}
			className={cn('mb-3 w-fit', className)}
		/>
	)
}

const LABELS = { recipes: 'Recipes', menus: 'Menus' } as const

/**
 * A phone's title on both lists: "Recipes" and "Menus" side by side at the
 * tab title's size, two links. The list showing is the page's heading, in
 * ink; the other is in the faint colour, which large text may take. Its
 * hover and press change only the text, so it never sits on a fill.
 *
 * Below 360px the two titles and the + no longer fit one row at 40px, so
 * the titles step down to 34px there.
 */
export function LibraryTitle({
	active,
	className,
}: {
	active: Library
	className?: string
}) {
	return (
		<nav
			aria-label="Library"
			className={cn('flex min-w-0 items-center gap-4', className)}
		>
			{(['recipes', 'menus'] as const).map((library) => {
				const current = library === active
				const link = (
					<Link
						to={PATHS[library]}
						// The same cross-fade as the switch.
						viewTransition
						aria-current={current ? 'page' : undefined}
						className={cn(
							'flex min-h-11 items-center transition-opacity active:opacity-60',
							current
								? 'text-foreground'
								: 'text-faint hover:text-muted-foreground',
						)}
					>
						{LABELS[library]}
					</Link>
				)
				return current ? (
					<TabTitle key={library} className="max-[22.5rem]:text-[2.125rem]">
						{link}
					</TabTitle>
				) : (
					<span
						key={library}
						className="font-serif text-[2.5rem] leading-[1.05] max-[22.5rem]:text-[2.125rem]"
					>
						{link}
					</span>
				)
			})}
		</nav>
	)
}
