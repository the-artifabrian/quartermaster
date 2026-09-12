import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { SharedRecipeView } from '#app/components/shared-recipe.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { sharedRecipeSelect } from '#app/utils/share-menu.server.ts'
import { type Route } from './+types/share.menus.$menuId_.recipes.$itemId.ts'

export const handle: SEOHandle = { getSitemapEntries: () => null }
export const meta: Route.MetaFunction = ({ loaderData }) => [
	{ title: `${loaderData?.recipe.title ?? 'Recipe'} | Quartermaster` },
]

export async function loader({ params }: Route.LoaderArgs) {
	const item = await prisma.menuItem.findFirst({
		where: {
			id: params.itemId,
			kind: 'recipe',
			section: { menuId: params.menuId },
		},
		select: {
			note: true,
			scaleMultiplier: true,
			section: {
				select: {
					menu: { select: { id: true, title: true, householdId: true } },
				},
			},
			recipe: { select: { ...sharedRecipeSelect, householdId: true } },
		},
	})
	invariantResponse(
		item?.recipe && item.recipe.householdId === item.section.menu.householdId,
		'Recipe not found in this Menu',
		{ status: 404 },
	)
	const { householdId: _, ...recipe } = item.recipe
	return {
		recipe,
		menuContext: {
			id: item.section.menu.id,
			title: item.section.menu.title,
			note: item.note,
			scaleMultiplier: item.scaleMultiplier ?? 1,
		},
	}
}

export default function SharedMenuRecipe({ loaderData }: Route.ComponentProps) {
	return (
		<SharedRecipeView
			key={`${loaderData.menuContext.id}:${loaderData.recipe.id}:${loaderData.menuContext.scaleMultiplier}`}
			loaderData={{
				recipe: loaderData.recipe,
				isLoggedIn: false,
				alreadySaved: false,
			}}
			menuContext={loaderData.menuContext}
		/>
	)
}
