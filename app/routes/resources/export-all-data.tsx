import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/export-all-data.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	const [user, recipes, inventory, mealPlans, shoppingLists, cookingLogs] =
		await Promise.all([
		prisma.user.findUniqueOrThrow({
			where: { id: userId },
			select: { username: true, email: true, name: true },
		}),
		prisma.recipe.findMany({
			where: { householdId },
			select: {
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
				location: true,
			},
			orderBy: [{ location: 'asc' }, { name: 'asc' }],
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
		prisma.cookingLog.findMany({
			where: { userId },
			select: {
				cookedAt: true,
				notes: true,
				recipe: { select: { title: true } },
			},
			orderBy: { cookedAt: 'desc' },
		}),
	])

	const exportData = {
		exportedAt: new Date().toISOString(),
		format: 'quartermaster-full-export-v1',
		user: {
			username: user.username,
			email: user.email,
			name: user.name,
		},
		recipes: recipes.map((recipe) => ({
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
			location: item.location,
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
		cookingLogs: cookingLogs.map((log) => ({
			cookedAt: log.cookedAt.toISOString(),
			notes: log.notes,
			recipe: log.recipe.title,
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
