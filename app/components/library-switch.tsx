import { useNavigation } from 'react-router'
import { SegmentedLinks } from './ui/segmented-control.tsx'

const LINKS = [
	{ key: 'recipes', to: '/recipes', label: 'Recipes', viewTransition: true },
	{ key: 'menus', to: '/recipes/menus', label: 'Menus', viewTransition: true },
] as const

/**
 * List-local switch between the Recipes and Menus libraries. Both live in the
 * global Recipes destination — this is a pair of route links, not a tab
 * system.
 */
export function LibrarySwitch({ active }: { active: 'recipes' | 'menus' }) {
	// Each list renders its own switch, so the pill slides while the other
	// list loads: it follows the pending navigation, not the page shown.
	const pending = useNavigation().location?.pathname
	return (
		<SegmentedLinks
			aria-label="Library"
			links={LINKS}
			current={LINKS.find((link) => link.key === active)!.to}
			pending={pending}
			className="mb-3 w-fit"
		/>
	)
}
