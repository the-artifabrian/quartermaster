// Run only against a new disposable database; refuses a populated database.
import { prisma } from '../../app/utils/db.server.ts'
import { getPasswordHash } from '../../app/utils/auth.server.ts'

if (await prisma.user.count())
	throw new Error('Use an empty disposable database')
const user = await prisma.user.create({
	data: {
		username: 'searchreview',
		email: 'search-review@example.test',
		name: 'Search review',
		password: { create: { hash: await getPasswordHash('local-search-248') } },
	},
})
const household = await prisma.household.create({
	data: {
		name: 'Disposable search review',
		staplesCutoverAt: new Date(),
		members: { create: { userId: user.id, role: 'owner' } },
	},
})
const cuisine = await prisma.recipeMetadataValue.create({
	data: {
		householdId: household.id,
		dimension: 'cuisine',
		name: 'Mediterranean',
		nameKey: 'mediterranean',
	},
})
for (const [title, totalTime, isFavorite, ingredient] of [
	['Walnut pasta', 25, false, 'walnuts'],
	['Chickpea lunch', null, true, 'chickpeas'],
	['Lemon rice', 30, true, 'rice'],
	['Slow roast', 120, false, 'chicken'],
] as const) {
	await prisma.recipe.create({
		data: {
			title,
			totalTime,
			isFavorite,
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: { name: ingredient, amount: '200', unit: 'g', order: 0 },
			},
			instructions: { create: { content: 'Prepare and serve.', order: 0 } },
			metadataAssignments: { create: { valueId: cuisine.id } },
		},
	})
}
await prisma.$disconnect()
console.log('Synthetic library ready: searchreview / local-search-248')
