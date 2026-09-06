// Run only against a new disposable database; refuses a populated database.
import { getPasswordHash } from '../../app/utils/auth.server.ts'
import { prisma } from '../../app/utils/db.server.ts'

if (await prisma.user.count())
	throw new Error('Use an empty disposable database')
const user = await prisma.user.create({
	data: {
		username: 'menureview',
		email: 'menu-review@example.test',
		name: 'Menu review',
		password: { create: { hash: await getPasswordHash('local-menu-246') } },
	},
})
const household = await prisma.household.create({
	data: {
		name: 'Disposable Menu review',
		staplesCutoverAt: new Date(),
		members: { create: { userId: user.id, role: 'owner' } },
	},
})
const recipe = await prisma.recipe.create({
	data: {
		title: 'Hummus',
		userId: user.id,
		householdId: household.id,
		yieldAmount: 4,
		yieldLabel: 'bowls',
		ingredients: {
			create: { name: 'chickpeas', amount: '400', unit: 'g', order: 0 },
		},
		instructions: { create: { content: 'Blend and serve.', order: 0 } },
	},
})
const menu = await prisma.menu.create({
	data: {
		id: 'menu-scale-review',
		title: 'Hummus dinner',
		titleKey: 'hummus dinner',
		householdId: household.id,
		sections: {
			create: {
				items: {
					create: [2, 0.5, 1].map((scaleMultiplier, order) => ({
						kind: 'recipe',
						recipeId: recipe.id,
						recipeTitle: recipe.title,
						scaleMultiplier,
						order,
					})),
				},
			},
		},
	},
})
await prisma.$disconnect()
console.log(`Synthetic Menu ready: /recipes/menus/${menu.id}`)
console.log('Sign in: menureview / local-menu-246')
