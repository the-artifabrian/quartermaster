import { getPasswordHash } from '../../app/utils/auth.server.ts'
import { prisma } from '../../app/utils/db.server.ts'

if (await prisma.user.count())
	throw new Error('Use an empty disposable database')
await prisma.role.upsert({
	where: { name: 'user' },
	update: {},
	create: { name: 'user' },
})
const users = []
for (const username of ['shoppingreview', 'shoppingmember']) {
	users.push(
		await prisma.user.create({
			data: {
				username,
				email: `${username}@example.test`,
				name: username,
				password: {
					create: { hash: await getPasswordHash('local-shopping-225') },
				},
				roles: { connect: { name: 'user' } },
				subscription: { create: { tier: 'pro' } },
			},
		}),
	)
}
const household = await prisma.household.create({
	data: {
		name: 'Disposable Shopping review',
		staplesCutoverAt: new Date(),
		members: {
			create: users.map((user, i) => ({
				userId: user.id,
				role: i ? 'member' : 'owner',
			})),
		},
	},
})
await prisma.shoppingList.create({
	data: {
		userId: users[0]!.id,
		householdId: household.id,
		items: {
			create: [
				{ name: 'Rice', quantity: '200', unit: 'g' },
				{ name: 'Milk', quantity: '1', unit: 'l' },
				{ name: 'Bread', checked: true },
				{ name: 'Coffee', horizon: 'later' },
			],
		},
	},
})
await prisma.$disconnect()
console.log('Ready: shoppingreview or shoppingmember / local-shopping-225')
