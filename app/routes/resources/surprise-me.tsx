import { redirect } from 'react-router'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/surprise-me.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)

	const count = await prisma.recipe.count({ where: { householdId } })
	if (count === 0) {
		return redirect('/recipes')
	}

	const offset = Math.floor(Math.random() * count)
	const [recipe] = await prisma.recipe.findMany({
		where: { householdId },
		select: { id: true },
		skip: offset,
		take: 1,
	})

	if (!recipe) {
		return redirect('/recipes')
	}

	return redirect(`/recipes/${recipe.id}`)
}
