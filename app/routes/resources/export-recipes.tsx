import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/export-recipes.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)

	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		select: {
			id: true,
			title: true,
			description: true,
			activeTime: true,
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
			isFavorite: true,
			sourceUrl: true,
			rawText: true,
			ingredients: {
				select: {
					name: true,
					amount: true,
					unit: true,
					notes: true,
					isHeading: true,
					linkedRecipeId: true,
				},
				orderBy: { order: 'asc' },
			},
			instructions: {
				select: { content: true },
				orderBy: { order: 'asc' },
			},
			image: { select: { objectKey: true, altText: true } },
			metadataAssignments: {
				select: {
					value: {
						select: {
							dimension: true,
							name: true,
							nameKey: true,
							sortOrder: true,
						},
					},
				},
				orderBy: { valueId: 'asc' },
			},
		},
		orderBy: { title: 'asc' },
	})

	// Export-local reference keys, as in the full export: an ingredient's
	// sub-Recipe link names the linked Recipe's ref, never a database id (#311).
	const recipeRefById = new Map(
		recipes.map((recipe, index) => [recipe.id, `r${index + 1}`]),
	)

	const exportData = {
		exportedAt: new Date().toISOString(),
		recipeCount: recipes.length,
		recipes: recipes.map((recipe) => ({
			ref: recipeRefById.get(recipe.id)!,
			title: recipe.title,
			description: recipe.description,
			activeTime: recipe.activeTime,
			totalTime: recipe.totalTime,
			yieldAmount: recipe.yieldAmount,
			yieldLabel: recipe.yieldLabel,
			isFavorite: recipe.isFavorite,
			sourceUrl: recipe.sourceUrl,
			rawText: recipe.rawText,
			metadataValues: recipe.metadataAssignments.map(
				(assignment) => assignment.value,
			),
			ingredients: recipe.ingredients.map((ing) => ({
				name: ing.name,
				amount: ing.amount,
				unit: ing.unit,
				notes: ing.notes,
				isHeading: ing.isHeading,
				linkedRecipeRef:
					(ing.linkedRecipeId && recipeRefById.get(ing.linkedRecipeId)) || null,
			})),
			instructions: recipe.instructions.map((inst) => ({
				content: inst.content,
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
