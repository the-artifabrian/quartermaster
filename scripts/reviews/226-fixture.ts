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
		username: 'shoppingreview',
		email: 'shoppingreview@example.test',
		name: 'Shopping review',
		password: { create: { hash: await getPasswordHash('local-shopping-226') } },
		roles: { connect: { name: 'user' } },
		subscription: { create: { tier: 'pro' } },
	},
})
const household = await prisma.household.create({
	data: {
		name: 'Disposable new purchase review',
		staplesCutoverAt: new Date(),
		members: { create: { userId: user.id, role: 'owner' } },
	},
})
const recipe = await prisma.recipe.create({
	data: {
		title: 'Rice supper',
		userId: user.id,
		householdId: household.id,
		ingredients: {
			create: { name: 'rice', amount: '400', unit: 'g', order: 0 },
		},
		instructions: { create: { content: 'Cook the rice.', order: 0 } },
	},
})
await prisma.shoppingList.create({
	data: {
		userId: user.id,
		householdId: household.id,
		items: {
			create: { name: 'rice', quantity: '200', unit: 'g', checked: true },
		},
	},
})
await prisma.$disconnect()
console.log('Ready: shoppingreview / local-shopping-226')
console.log(`Open /recipes/${recipe.id} and add rice to Shopping.`)
