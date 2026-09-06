// Use a new disposable database; never replace an existing household.
import { getPasswordHash } from '../../app/utils/auth.server.ts'
import { prisma } from '../../app/utils/db.server.ts'

if (await prisma.user.count())
	throw new Error('Use an empty disposable database')
await prisma.role.upsert({
	where: { name: 'user' },
	update: {},
	create: { name: 'user' },
})
const user = await prisma.user.create({
	data: {
		username: 'entryreview',
		email: 'entry-review@example.test',
		name: 'Entry review',
		password: { create: { hash: await getPasswordHash('local-entry-232') } },
		roles: { connect: { name: 'user' } },
	},
})
const household = await prisma.household.create({
	data: {
		name: 'Disposable entry review',
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
await prisma.recipe.create({
	data: {
		id: 'entry-review-pasta',
		title: 'Walnut pasta',
		userId: user.id,
		householdId: household.id,
		description: 'A weeknight pasta with toasted walnuts and lemon.',
		sourceUrl: 'https://example.test/walnut-pasta',
		notes: 'Keep a cup of pasta water before draining.',
		activeTime: 15,
		totalTime: 25,
		yieldAmount: 2,
		yieldLabel: 'bowls',
		metadataAssignments: { create: { valueId: cuisine.id } },
		ingredients: {
			create: [
				{
					name: 'pasta',
					amount: '200',
					unit: 'g',
					notes:
						'Cook in generously salted water until just tender; reserve some cooking water to loosen the sauce before serving.',
					order: 0,
				},
				{
					name: 'walnuts',
					amount: '50',
					unit: 'g',
					notes: 'Toast gently, then roughly chop.',
					order: 1,
				},
			],
		},
		instructions: {
			create: [
				{
					content: 'Boil the pasta and reserve a cup of cooking water.',
					order: 0,
				},
				{
					content: 'Toss with walnuts, loosen with cooking water, and serve.',
					order: 1,
				},
			],
		},
	},
})
await prisma.$disconnect()
console.log('Preview ready: entryreview / local-entry-232')
