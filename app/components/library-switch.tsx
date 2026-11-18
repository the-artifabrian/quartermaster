import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { SegmentedLinks } from './ui/segmented-control.tsx'

type Library = 'recipes' | 'menus'

const PATHS = { recipes: '/recipes', menus: '/recipes/menus' } as const

// History entries whose arrival has already slid the pill, so Back to one
// does not slide it again.
const slidEntries = new Set<string>()

/**
 * List-local switch between the Recipes and Menus libraries. Both live in the
 * global Recipes destination — this is a pair of route links, not a tab
 * system.
 */
export function LibrarySwitch({ active }: { active: Library }) {
	const location = useLocation()
	const state = location.state as { librarySwitchFrom?: Library } | null
	const from =
		state?.librarySwitchFrom && !slidEntries.has(location.key)
			? PATHS[state.librarySwitchFrom]
			: undefined
	useEffect(() => {
		if (from) slidEntries.add(location.key)
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
