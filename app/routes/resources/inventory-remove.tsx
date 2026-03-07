import { invariantResponse } from '@epic-web/invariant'
import { data } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/inventory-remove.ts'

export async function action({ request }: Route.ActionArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const inventoryItemId = formData.get('inventoryItemId')
	invariantResponse(
		typeof inventoryItemId === 'string',
		'Inventory item ID is required',
	)

	const item = await prisma.inventoryItem.findFirst({
		where: { id: inventoryItemId, householdId },
	})
	invariantResponse(item, 'Inventory item not found', { status: 404 })

	await prisma.inventoryItem.delete({ where: { id: inventoryItemId } })

	return data({ success: true })
}
