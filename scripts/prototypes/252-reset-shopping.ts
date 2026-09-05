export {}
// Reset ONLY the named synthetic household's Shopping for another real-app trial.
process.env.DATABASE_URL = 'file:/private/tmp/qm-252-review/data.db'
const { prisma } = await import('../../app/utils/db.server.ts')
const user = await prisma.user.findUniqueOrThrow({
	where: { username: 'review252' },
})
const household = await prisma.household.findFirstOrThrow({
	where: {
		name: 'Disposable Saturday supper',
		members: { some: { userId: user.id } },
	},
})
const list = await prisma.shoppingList.findUniqueOrThrow({
	where: { householdId: household.id },
})
await prisma.shoppingListItem.deleteMany({ where: { listId: list.id } })
await prisma.shoppingListItem.createMany({
	data: [
		{
			listId: list.id,
			name: 'milk',
			quantity: '1',
			unit: 'l',
			source: 'manual',
		},
		{
			listId: list.id,
			name: 'garlic',
			quantity: '2',
			unit: 'cloves',
			source: 'manual',
			checked: true,
		},
	],
})
await prisma.$disconnect()
console.log(
	'Synthetic Shopping reset. Reload Plan and Shop before the next trial.',
)
