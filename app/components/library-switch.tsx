import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { SegmentedLinks } from './ui/segmented-control.tsx'

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
 * global Recipes destination — this is a pair of route links, not a tab
 * system.
 */
export function LibrarySwitch({ active }: { active: Library }) {
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
			className="mb-3 w-fit"
		/>
	)
}
