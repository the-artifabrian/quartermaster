import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/export-all-data.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	const [user, recipes, inventory, mealPlans, shoppingLists, menus] =
		await Promise.all([
			prisma.user.findUniqueOrThrow({
				where: { id: userId },
				select: { username: true, email: true, name: true },
			}),
			prisma.recipe.findMany({
				where: { householdId },
				select: {
					id: true,
					title: true,
					description: true,
					servings: true,
					prepTime: true,
					cookTime: true,
					isFavorite: true,
					sourceUrl: true,
					notes: true,
					ingredients: {
						select: { name: true, amount: true, unit: true, notes: true },
						orderBy: { order: 'asc' },
					},
					instructions: {
						select: { content: true },
						orderBy: { order: 'asc' },
					},
					image: { select: { objectKey: true, altText: true } },
				},
				orderBy: { title: 'asc' },
			}),
			prisma.inventoryItem.findMany({
				where: { householdId },
				select: {
					name: true,
				},
				orderBy: [{ name: 'asc' }],
			}),
			prisma.mealPlan.findMany({
				where: { householdId },
				select: {
					weekStart: true,
					entries: {
						select: {
							date: true,
							mealType: true,
							servings: true,
							cooked: true,
							recipe: { select: { title: true } },
						},
						orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
					},
				},
				orderBy: { weekStart: 'desc' },
			}),
			prisma.shoppingList.findMany({
				where: { householdId },
				select: {
					name: true,
					items: {
						select: {
							name: true,
							quantity: true,
							unit: true,
							category: true,
							checked: true,
							source: true,
						},
						orderBy: { name: 'asc' },
					},
				},
				orderBy: { updatedAt: 'desc' },
			}),
			prisma.menu.findMany({
				where: { householdId },
				select: {
					title: true,
					description: true,
					defaultGuestCount: true,
					sections: {
						orderBy: { order: 'asc' },
						select: {
							name: true,
							items: {
								orderBy: { order: 'asc' },
								select: {
									kind: true,
									recipeId: true,
									recipeTitle: true,
									scaleMultiplier: true,
									note: true,
									shoppingLines: {
										orderBy: { order: 'asc' },
										select: { name: true, quantity: true, unit: true },
									},
								},
							},
						},
					},
				},
				orderBy: { title: 'asc' },
			}),
		])

	// Export-local reference keys: import restores Menu Recipe references by
	// key, so renamed Recipes still reconnect; title fallback is for older
	// exports only (#102).
	const recipeRefById = new Map(
		recipes.map((recipe, index) => [recipe.id, `r${index + 1}`]),
	)

	const exportData = {
		exportedAt: new Date().toISOString(),
		format: 'quartermaster-full-export-v1',
		user: {
			username: user.username,
			email: user.email,
			name: user.name,
		},
		recipes: recipes.map((recipe) => ({
			ref: recipeRefById.get(recipe.id)!,
			title: recipe.title,
			description: recipe.description,
			servings: recipe.servings,
			prepTime: recipe.prepTime,
			cookTime: recipe.cookTime,
			isFavorite: recipe.isFavorite,
			sourceUrl: recipe.sourceUrl,
			notes: recipe.notes,
			ingredients: recipe.ingredients.map((ing) => ({
				name: ing.name,
				amount: ing.amount,
				unit: ing.unit,
				notes: ing.notes,
			})),
			instructions: recipe.instructions.map((inst) => inst.content),
			image: recipe.image
				? {
						url: `/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`,
						altText: recipe.image.altText,
					}
				: null,
		})),
		inventory: inventory.map((item) => ({
			name: item.name,
		})),
		mealPlans: mealPlans.map((plan) => ({
			weekStart: plan.weekStart.toISOString(),
			entries: plan.entries.map((entry) => ({
				date: entry.date.toISOString(),
				mealType: entry.mealType,
				servings: entry.servings,
				cooked: entry.cooked,
				recipe: entry.recipe.title,
			})),
		})),
		shoppingLists: shoppingLists.map((list) => ({
			name: list.name,
			items: list.items.map((item) => ({
				name: item.name,
				quantity: item.quantity,
				unit: item.unit,
				category: item.category,
				checked: item.checked,
				source: item.source,
			})),
		})),
		// Menus are durable recovery data: sections, Recipe/note cards, scale
		// multipliers, notes, ordering, and note Shopping lines — never
		// transient UI state (#102). Missing cards export a null recipeRef with
		// their frozen title.
		menus: menus.map((menu) => ({
			title: menu.title,
			description: menu.description,
			defaultGuestCount: menu.defaultGuestCount,
			sections: menu.sections.map((section) => ({
				name: section.name,
				items: section.items.map((item) =>
					item.kind === 'note'
						? {
								kind: 'note' as const,
								text: item.note,
								shoppingLines: item.shoppingLines.map((line) => ({
									name: line.name,
									quantity: line.quantity,
									unit: line.unit,
								})),
							}
						: {
								kind: 'recipe' as const,
								recipeRef:
									(item.recipeId && recipeRefById.get(item.recipeId)) || null,
								recipeTitle: item.recipeTitle,
								scaleMultiplier: item.scaleMultiplier,
								note: item.note,
							},
				),
			})),
		})),
	}

	const date = new Date().toISOString().split('T')[0]

	return new Response(JSON.stringify(exportData, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="quartermaster-export-${date}.json"`,
		},
	})
}
