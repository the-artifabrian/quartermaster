import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/ingredient-suggestions.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)

	const ingredients = await prisma.ingredient.findMany({
		where: { recipe: { userId } },
		select: { name: true },
		distinct: ['name'],
		orderBy: { name: 'asc' },
	})

	return { ingredients: ingredients.map((i) => i.name) }
}
