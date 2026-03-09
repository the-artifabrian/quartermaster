import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/recipe-search.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const url = new URL(request.url)
	const query = url.searchParams.get('q')?.trim() ?? ''

	if (query.length < 2) {
		return { recipes: [] }
	}

	const exclude = url.searchParams.get('exclude') ?? undefined

	const recipes = await prisma.recipe.findMany({
		where: {
			householdId,
			title: { contains: query },
			...(exclude ? { id: { not: exclude } } : {}),
		},
		select: { id: true, title: true },
		orderBy: { title: 'asc' },
		take: 10,
	})

	return { recipes }
}
