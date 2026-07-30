import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '#app/generated/prisma/client.ts'

type ShoppingListDatabase = Pick<
	Prisma.TransactionClient,
	'$executeRaw' | 'shoppingList'
>

export async function ensureShoppingList(
	db: ShoppingListDatabase,
	{
		userId,
		householdId,
		name = 'Shopping List',
	}: {
		userId: string
		householdId: string
		name?: string
	},
) {
	const now = new Date()
	// Prisma emulates an upsert with an empty update as SELECT then INSERT.
	// Keep first-touch creation atomic across clients with one SQLite statement.
	await db.$executeRaw`
		INSERT INTO "ShoppingList" (
			"id", "name", "userId", "householdId", "createdAt", "updatedAt"
		)
		VALUES (
			${createId()}, ${name}, ${userId}, ${householdId}, ${now}, ${now}
		)
		ON CONFLICT ("householdId") DO NOTHING
	`

	return db.shoppingList.findUniqueOrThrow({
		where: { householdId },
	})
}
