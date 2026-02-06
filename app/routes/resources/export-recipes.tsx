import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/export-recipes.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)

	const recipes = await prisma.recipe.findMany({
		where: { userId },
		select: {
			title: true,
			description: true,
			servings: true,
			prepTime: true,
			cookTime: true,
			isFavorite: true,
			sourceUrl: true,
			ingredients: {
				select: { name: true, amount: true, unit: true, notes: true },
				orderBy: { order: 'asc' },
			},
			instructions: {
				select: { content: true },
				orderBy: { order: 'asc' },
			},
			tags: {
				select: { name: true, category: true },
			},
			image: { select: { objectKey: true, altText: true } },
		},
		orderBy: { title: 'asc' },
	})

	const exportData = {
		exportedAt: new Date().toISOString(),
		recipeCount: recipes.length,
		recipes: recipes.map((recipe) => ({
			title: recipe.title,
			description: recipe.description,
			servings: recipe.servings,
			prepTime: recipe.prepTime,
			cookTime: recipe.cookTime,
			isFavorite: recipe.isFavorite,
			sourceUrl: recipe.sourceUrl,
			ingredients: recipe.ingredients.map((ing) => ({
				name: ing.name,
				amount: ing.amount,
				unit: ing.unit,
				notes: ing.notes,
			})),
			instructions: recipe.instructions.map((inst) => ({
				content: inst.content,
			})),
			tags: recipe.tags.map((tag) => ({
				name: tag.name,
				category: tag.category,
			})),
			image: recipe.image
				? {
						url: `/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`,
						altText: recipe.image.altText,
					}
				: null,
		})),
	}

	const date = new Date().toISOString().split('T')[0]

	return new Response(JSON.stringify(exportData, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="quartermaster-recipes-${date}.json"`,
		},
	})
}
