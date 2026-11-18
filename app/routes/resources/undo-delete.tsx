import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	deleteMeal,
	deleteMealItem,
	deleteShoppingRows,
	removeStaple,
	restoreMeal,
	restoreMealItem,
	restoreShoppingRows,
	restoreStaple,
	sealUndo,
	redeemUndo,
	type DeleteResult,
	MAX_UNDO_ROWS,
	MAX_UNDO_TOKEN,
	type UndoSnapshot,
} from '#app/utils/undo-delete.server.ts'
import { type Route } from './+types/undo-delete.ts'

const headers = { 'Cache-Control': 'private, no-store' }

/** A Meal as the other member's notice names it. */
function mealName(snapshot: {
	meal: { genericText: string | null; label: string | null }
	recipeItems: Array<{ recipeTitle: string }>
}) {
	return (
		snapshot.meal.genericText ??
		(snapshot.recipeItems.length === 1
			? snapshot.recipeItems[0]!.recipeTitle
			: (snapshot.meal.label ?? 'a Meal'))
	)
}
const id = z.string().min(1).max(64)

const UndoRequest = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('delete-shopping'),
		// Clear checked sends at most this many (the page sends no more).
		itemIds: z.array(id).min(1).max(MAX_UNDO_ROWS),
		/** Clear checked: only rows still checked go. */
		checkedOnly: z.boolean().optional(),
	}),
	z.object({
		intent: z.literal('delete-meal'),
		mealId: id,
		removeShoppingContributions: z.boolean(),
	}),
	z.object({ intent: z.literal('delete-meal-item'), itemId: id }),
	z.object({ intent: z.literal('remove-staple'), stapleId: id }),
	z.object({
		intent: z.literal('restore'),
		token: z.string().max(MAX_UNDO_TOKEN),
	}),
])

/**
 * Deletes that an Undo toast can reverse, and the reversal. Plain JSON, so a
 * failure stays with the toast instead of reaching a route's error page, and
 * every answer says what happened: `deleted` (with what to send back for
 * Undo), `gone` (nothing there to delete or put back) or `restored`.
 */
export async function action({ request }: Route.ActionArgs) {
	let identity: { userId: string; householdId: string }
	try {
		identity = await requireUserWithHousehold(request)
	} catch (error) {
		if (error instanceof Response && error.status < 500) {
			return Response.json({ status: 'denied' }, { status: 401, headers })
		}
		throw error
	}
	const body: unknown = await request.json().catch(() => null)
	const originClientId =
		body && typeof body === 'object' && 'originClientId' in body
			? body.originClientId
			: undefined
	const parsed = UndoRequest.safeParse(body)
	if (!parsed.success) {
		return Response.json({ status: 'invalid' }, { status: 400, headers })
	}
	const { userId, householdId } = identity
	const scope = { householdId }
	const emit = (
		type: Parameters<typeof emitHouseholdEvent>[0]['type'],
		payload: Record<string, unknown>,
	) =>
		void emitHouseholdEvent({
			type,
			payload,
			userId,
			householdId,
			originClientId,
		})
	const input = parsed.data

	// The snapshot goes out sealed; Undo brings the seal back.
	const answer = (result: DeleteResult) =>
		Response.json(
			result.status === 'deleted'
				? { status: 'deleted', token: sealUndo(result.snapshot, identity) }
				: result,
			{ headers },
		)

	if (input.intent === 'restore') {
		const redeemed = redeemUndo(input.token, identity)
		if (redeemed === 'refused') {
			return Response.json({ status: 'refused' }, { status: 403, headers })
		}
		// Used before: whatever it put back is back.
		if (redeemed === 'used')
			return Response.json({ status: 'gone' }, { headers })
		try {
			return Response.json(await restore(redeemed.snapshot), { headers })
		} catch (error) {
			// Something it needed changed under it: nothing was put back, and
			// the seal can be used again.
			redeemed.release()
			console.error('Undo restore failed', error)
			return Response.json({ status: 'conflict' }, { status: 409, headers })
		}
	}

	async function restore(snapshot: UndoSnapshot) {
		if (snapshot.kind === 'shopping') {
			const result = await restoreShoppingRows(prisma, {
				...scope,
				rows: snapshot.rows,
			})
			if (result.status === 'restored') {
				// What came back, not what was asked for.
				const { names, amounts } = result
				const name =
					names.length === 1
						? names[0]
						: names.length > 1
							? snapshot.rows.every((row) => row.checked)
								? `${names.length} checked items`
								: `${names.length} items`
							: `${amounts} Meal amounts`
				emit('shopping_list_restored', { name })
			}
			return result
		}
		if (snapshot.kind === 'meal') {
			const result = await restoreMeal(prisma, {
				...scope,
				snapshot: snapshot.meal,
			})
			if (result.status === 'restored' && result.shoppingChanged) {
				emit('shopping_list_restored', {
					name: `the amounts for ${mealName(snapshot.meal)}`,
				})
			}
			return { status: result.status }
		}
		if (snapshot.kind === 'meal-item') {
			return restoreMealItem(prisma, { ...scope, item: snapshot.item })
		}
		return restoreStaple(prisma, { ...scope, stapleId: snapshot.id })
	}

	if (input.intent === 'delete-shopping') {
		const result = await deleteShoppingRows(prisma, {
			...scope,
			ids: input.itemIds,
			checkedOnly: input.checkedOnly,
		})
		if (result.status === 'deleted') {
			if (input.checkedOnly) emit('shopping_list_cleared', {})
			else
				emit('shopping_list_item_deleted', {
					name: result.name ?? `${result.count} items`,
				})
		}
		return answer(result)
	}
	if (input.intent === 'delete-meal') {
		const result = await deleteMeal(prisma, { ...scope, ...input })
		// Only when Shopping lost something: "remove generated amount" on a
		// Meal with nothing there sends nothing.
		if (
			result.status === 'deleted' &&
			result.snapshot.kind === 'meal' &&
			result.snapshot.meal.removedRows.length +
				result.snapshot.meal.removedContributions.length >
				0
		) {
			emit('shopping_list_item_deleted', {
				name: `the amounts for ${mealName(result.snapshot.meal)}`,
			})
		}
		return answer(result)
	}
	if (input.intent === 'delete-meal-item') {
		return answer(
			await deleteMealItem(prisma, { ...scope, itemId: input.itemId }),
		)
	}
	return answer(
		await removeStaple(prisma, { ...scope, stapleId: input.stapleId }),
	)
}
