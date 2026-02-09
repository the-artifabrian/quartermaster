import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/ingredient-suggestions.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)

	const ingredients = await prisma.ingredient.findMany({
		where: { recipe: { householdId } },
		select: { name: true },
		distinct: ['name'],
		orderBy: { name: 'asc' },
	})

	return { ingredients: ingredients.map((i) => i.name) }
}
