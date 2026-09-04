import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/plan-choices.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const [recipes, menuChoices] = await Promise.all([
		prisma.recipe.findMany({
			where: { householdId },
			orderBy: { title: 'asc' },
			select: {
				id: true,
				title: true,
				totalTime: true,
				yieldAmount: true,
				yieldLabel: true,
				isFavorite: true,
				image: { select: { objectKey: true } },
			},
		}),
		prisma.menu.findMany({
			where: {
				householdId,
				// Blank drafts have nothing the planner can copy.
				sections: { some: { items: { some: {} } } },
			},
			orderBy: { updatedAt: 'desc' },
			select: {
				id: true,
				title: true,
				sections: {
					orderBy: { order: 'asc' },
					select: {
						items: {
							orderBy: { order: 'asc' },
							select: {
								kind: true,
								recipeTitle: true,
								recipe: { select: { title: true } },
							},
						},
					},
				},
			},
		}),
	])
	const menus = menuChoices.map((menu) => {
		const items = menu.sections.flatMap((section) => section.items)
		const recipeItems = items.filter((item) => item.kind === 'recipe')
		return {
			id: menu.id,
			title: menu.title,
			recipeCount: recipeItems.length,
			noteCount: items.length - recipeItems.length,
			recipeTitles: recipeItems.flatMap((item) => {
				const title = item.recipe?.title ?? item.recipeTitle
				return title ? [title] : []
			}),
		}
	})

	return data(
		{ recipes, menus },
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}
