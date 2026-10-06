import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet } from 'react-router'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

// No loader: every child loader and action signs the request in itself
// (requireUserWithHousehold or requireUserWithTier), and a guard here would add
// a .data request beside each child's own on every entry to Recipes.
export default function RecipesLayout() {
	return (
		<div className="flex min-h-[calc(100vh-6rem)] flex-col">
			<Outlet />
		</div>
	)
}
