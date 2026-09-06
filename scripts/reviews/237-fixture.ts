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
		username: 'cookingreview',
		email: 'cooking-review@example.test',
		name: 'Cooking review',
		password: { create: { hash: await getPasswordHash('local-cooking-237') } },
		roles: { connect: { name: 'user' } },
	},
})
const household = await prisma.household.create({
	data: {
		name: 'Disposable cooking review',
		staplesCutoverAt: new Date(),
		members: { create: { userId: user.id, role: 'owner' } },
	},
})
await prisma.recipe.create({
	data: {
		id: 'cooking-review-pasta',
		title: 'Walnut pasta',
		userId: user.id,
		householdId: household.id,
		description: 'Pasta with toasted walnuts and lemon.',
		activeTime: 15,
		totalTime: 20,
		yieldAmount: 2,
		yieldLabel: 'bowls',
		ingredients: {
			create: [
				{ name: 'pasta', amount: '200', unit: 'g', order: 0 },
				{ name: 'walnuts', amount: '50', unit: 'g', order: 1 },
				{ name: 'lemon', amount: '1', order: 2 },
			],
		},
		instructions: {
			create: [
				{
					content:
						'Boil the pasta for 10 minutes. Reserve a cup of cooking water.',
					order: 0,
				},
				{
					content: 'Toast the walnuts gently for 3 minutes, then roughly chop.',
					order: 1,
				},
				{
					content:
						'Toss the pasta with walnuts and lemon. Loosen with cooking water and serve.',
					order: 2,
				},
			],
		},
	},
})
await prisma.$disconnect()
console.log('Preview ready: cookingreview / local-cooking-237')
