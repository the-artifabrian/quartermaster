// Shopping's writes, with one handler for each form intent.
import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { data } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { parseTypedItem } from '#app/utils/parse-speech-item.ts'
import { addPickedMealsToShopping } from '#app/utils/shopping-adds.server.ts'
import {
	editShoppingDisplayGroup,
	removeGeneratedShoppingAmount,
} from '#app/utils/shopping-contribution.server.ts'
import {
	buildShoppingDemand,
	combineDemandParts,
	combineRowDisplay,
	demandIdentity,
} from '#app/utils/shopping-demand.server.ts'
import { parseShoppingHorizon } from '#app/utils/shopping-horizon.ts'
import { type ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import {
	BulkAddItemsSchema,
	EditShoppingItemSchema,
	ShoppingListItemSchema,
	guessCategory,
} from '#app/utils/shopping-list-validation.ts'
import { keepsOwnAmount } from '#app/utils/shopping-row-source.ts'

type ShoppingActionContext = {
	formData: FormData
	userId: string
	householdId: string
	shoppingList: Awaited<ReturnType<typeof ensureShoppingList>>
}

export const shoppingActions = {
	// From Plan: the household picks Meals and lines in the picker, and each
	// ticked Meal writes through the same Meal-add path as adding that Meal
	// from Plan. There is no week-wide rebuild: a second pick of the same Meal
	// records nothing new, and an untouched line stays off.
	async 'add-from-plan'({
		formData,
		userId,
		householdId,
		shoppingList,
	}: ShoppingActionContext) {
		const rawPicks = formData.get('picks')
		invariantResponse(typeof rawPicks === 'string', 'Picks are required')
		let picks: Array<{ mealId: string; lines: string[] }>
		try {
			picks = JSON.parse(rawPicks) as typeof picks
		} catch {
			throw new Response('Invalid picks data', { status: 400 })
		}
		invariantResponse(
			Array.isArray(picks) &&
				picks.length > 0 &&
				picks.length <= 50 &&
				picks.every(
					(pick) =>
						pick != null &&
						typeof pick.mealId === 'string' &&
						Array.isArray(pick.lines) &&
						pick.lines.every((name) => typeof name === 'string'),
				),
			'Invalid picks data',
		)

		// One tick set per Meal, so a repeated Meal id is one reconcile.
		const pickedByMeal = new Map<string, Set<string>>()
		for (const pick of picks) {
			const lines = pickedByMeal.get(pick.mealId) ?? new Set<string>()
			for (const name of pick.lines) lines.add(name)
			pickedByMeal.set(pick.mealId, lines)
		}

		const {
			createdRowCount,
			attachedCount,
			alreadyContributedCount,
			promotedRowCount,
		} = await addPickedMealsToShopping(prisma, {
			householdId,
			listId: shoppingList.id,
			pickedByMeal,
		})

		const changedCount = createdRowCount + attachedCount + promotedRowCount
		if (changedCount > 0) {
			void emitHouseholdEvent({
				originClientId: formData.get('originClientId'),
				type: 'shopping_list_generated',
				payload: { count: changedCount },
				userId,
				householdId,
			})
		}

		return {
			status: 'success' as const,
			createdRowCount,
			attachedCount,
			alreadyContributedCount,
			promotedRowCount,
		}
	},

	async add({
		formData,
		userId,
		householdId,
		shoppingList,
	}: ShoppingActionContext) {
		const submission = parseWithZod(formData, {
			schema: ShoppingListItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		const force = formData.get('force') === 'true'
		const horizon = parseShoppingHorizon(formData.get('horizon'))

		// "2 lemons" typed into the bare input becomes qty 2 + "lemons".
		// Only when no quantity came along: the Qty & unit fields win.
		// Parsing happens before the duplicate check so "2 lemons"
		// matches an existing "lemons" row.
		let { name, quantity, unit } = submission.value
		if (!quantity) {
			const parsed = parseTypedItem(name)
			if (parsed && parsed.name) {
				name = parsed.name
				quantity = parsed.quantity
				unit = parsed.unit || unit
			}
		}

		const canonicalName = demandIdentity(name)

		// An unchecked cross-section match is never silently duplicated, even
		// when the ordinary same-section "add anyway" path is forced.
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id, checked: false },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		})
		const duplicate = existingItems.find(
			(item) => demandIdentity(item.name) === canonicalName,
		)
		if (duplicate && duplicate.horizon !== horizon) {
			return {
				status: 'warning' as const,
				warningType: 'move_to_section' as const,
				existingName: duplicate.name,
				existingQuantity: duplicate.quantity,
				existingUnit: duplicate.unit,
				existingHorizon: duplicate.horizon,
				targetHorizon: horizon,
				itemId: duplicate.id,
			}
		}

		if (!force && duplicate) {
			return {
				status: 'warning' as const,
				warningType: 'already_on_list' as const,
				existingName: duplicate.name,
				existingQuantity: duplicate.quantity,
				existingUnit: duplicate.unit,
				submittedName: name,
				submittedQuantity: quantity,
				submittedUnit: unit,
				targetHorizon: horizon,
			}
		}

		// Auto-categorize if no category provided
		const category = submission.value.category || guessCategory(name)

		const created = await prisma.shoppingListItem.create({
			data: {
				name,
				quantity,
				unit,
				category,
				listId: shoppingList.id,
				source: 'manual',
				horizon,
			},
			select: { id: true, name: true, quantity: true, unit: true },
		})

		void emitHouseholdEvent({
			originClientId: formData.get('originClientId'),
			type: 'shopping_list_item_added',
			payload: { name },
			userId,
			householdId,
		})

		return {
			status: 'success' as const,
			submission: submission.reply({ resetForm: true }),
			// The row as saved ("2 lemons" is saved as lemons, 2), so the add
			// sheet can list it and take it back.
			item: created,
		}
	},

	async move({ formData, userId, householdId }: ShoppingActionContext) {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')
		const horizon = parseShoppingHorizon(formData.get('horizon'))
		const item = await prisma.shoppingListItem.findFirst({
			where: { id: itemId, list: { householdId } },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.shoppingListItem.update({
			where: { id: item.id },
			data: { horizon },
		})
		void emitHouseholdEvent({
			originClientId: formData.get('originClientId'),
			type: 'shopping_list_item_edited',
			payload: { name: item.name, horizon },
			userId,
			householdId,
		})
		return { status: 'success' as const, moved: 1, horizon }
	},

	async 'move-items'({ formData, userId, householdId }: ShoppingActionContext) {
		const rawItemIds = formData.get('itemIds')
		invariantResponse(typeof rawItemIds === 'string', 'Item IDs are required')
		let itemIds: string[]
		try {
			itemIds = JSON.parse(rawItemIds) as string[]
		} catch {
			throw new Response('Invalid item IDs', { status: 400 })
		}
		invariantResponse(
			Array.isArray(itemIds) &&
				itemIds.length > 0 &&
				itemIds.length <= 100 &&
				itemIds.every((id) => typeof id === 'string'),
			'Invalid item IDs',
		)
		const horizon = parseShoppingHorizon(formData.get('horizon'))
		const result = await prisma.shoppingListItem.updateMany({
			where: {
				id: { in: [...new Set(itemIds)] },
				list: { householdId },
				checked: false,
			},
			data: { horizon },
		})
		if (result.count > 0) {
			void emitHouseholdEvent({
				originClientId: formData.get('originClientId'),
				type: 'shopping_list_item_edited',
				payload: { count: result.count, horizon },
				userId,
				householdId,
			})
		}
		return { status: 'success' as const, moved: result.count, horizon }
	},

	async edit({ formData, userId, householdId }: ShoppingActionContext) {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const submission = parseWithZod(formData, {
			schema: EditShoppingItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}
		const observedVersion = parseObservedVersion(formData)
		if (observedVersion == null) {
			// The answer an older page already shows in its editor.
			return data(
				{
					status: 'error' as const,
					submission: submission.reply({ formErrors: [RELOAD_TO_CHANGE] }),
				},
				{ status: 400 },
			)
		}

		const result = await editShoppingDisplayGroup(prisma, {
			householdId,
			itemId,
			observedVersion,
			name: submission.value.name,
			quantity: submission.value.quantity ?? null,
			unit: submission.value.unit ?? null,
		})
		if (result.status === 'missing') {
			throw new Response('Item not found', { status: 404 })
		}
		if (result.status === 'conflict') {
			return rowChanged(householdId, itemId)
		}

		void emitHouseholdEvent({
			originClientId: formData.get('originClientId'),
			type: 'shopping_list_item_edited',
			payload: { name: submission.value.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	},

	async removeGeneratedAmount({
		formData,
		userId,
		householdId,
	}: ShoppingActionContext) {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')
		const observedVersion = parseObservedVersion(formData)
		if (observedVersion == null) return reloadToChange()

		const result = await removeGeneratedShoppingAmount(prisma, {
			householdId,
			itemId,
			observedVersion,
		})
		if (result.status !== 'success') {
			if (result.status === 'conflict') return rowChanged(householdId, itemId)
			throw new Response('Mixed Shopping group not found', { status: 404 })
		}
		void emitHouseholdEvent({
			originClientId: formData.get('originClientId'),
			type: 'shopping_list_item_edited',
			payload: { name: result.name },
			userId,
			householdId,
		})
		return { status: 'success' as const }
	},

	async 'bulk-add'({
		formData,
		userId,
		householdId,
		shoppingList,
	}: ShoppingActionContext) {
		const rawItems = formData.get('items')
		let json: unknown = null
		try {
			json = typeof rawItems === 'string' ? JSON.parse(rawItems) : null
		} catch {
			// Read as invalid below.
		}
		const parsedItems = BulkAddItemsSchema.safeParse(json)
		// An answer the page shows as a toast. A thrown 400 would replace
		// Shopping with the error page.
		if (!parsedItems.success) {
			return data(
				{
					status: 'error' as const,
					message: 'Couldn’t add these items. Try fewer, or shorter names.',
				},
				{ status: 400 },
			)
		}
		const items = parsedItems.data

		// Ordinary note Shopping lines go through buildShoppingDemand, which
		// trims and normalizes each line's identity and keeps the free text.
		const demandLines = buildShoppingDemand({ noteLines: items })
		const horizon = parseShoppingHorizon(formData.get('horizon'))

		// Dedup against all existing items and within the batch. Unchecked
		// cross-section matches come back as offers to move the row.
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			select: { id: true, name: true, checked: true, horizon: true },
		})
		const existingByCanonical = new Map<string, typeof existingItems>()
		for (const item of existingItems) {
			const canonicalName = demandIdentity(item.name)
			const group = existingByCanonical.get(canonicalName) ?? []
			group.push(item)
			existingByCanonical.set(canonicalName, group)
		}
		const seen = new Set<string>()
		const moveItemIds: string[] = []
		const newItems = demandLines.filter((line) => {
			if (seen.has(line.canonicalName)) return false
			seen.add(line.canonicalName)
			const matches = existingByCanonical.get(line.canonicalName) ?? []
			const crossSectionMatch = matches.find(
				(item) => !item.checked && item.horizon !== horizon,
			)
			if (crossSectionMatch) moveItemIds.push(crossSectionMatch.id)
			if (matches.length > 0) return false
			return true
		})

		if (newItems.length > 0) {
			await prisma.shoppingListItem.createMany({
				data: newItems.map(({ canonicalName, fromNote, ...line }) => ({
					...line,
					listId: shoppingList.id,
					source: 'manual' as const,
					horizon,
				})),
			})

			void emitHouseholdEvent({
				originClientId: formData.get('originClientId'),
				type: 'shopping_list_item_added',
				payload: { count: newItems.length, source: 'voice' },
				userId,
				householdId,
			})
		}

		return {
			status: 'success' as const,
			addedCount: newItems.length,
			moveItemIds,
			horizon,
		}
	},
}

const ObservedVersionSchema = z
	.string()
	.regex(/^\d{1,15}$/)
	.transform(Number)

/** The row version the person saw when they opened Edit or the row menu. */
function parseObservedVersion(formData: FormData) {
	const parsed = ObservedVersionSchema.safeParse(
		formData.get('observedVersion'),
	)
	return parsed.success ? parsed.data : null
}

const RELOAD_TO_CHANGE = 'Reload Shopping, then try again.'

/** A page loaded before row versions has to reload to change a row. */
function reloadToChange() {
	return data(
		{ status: 'invalid' as const, message: RELOAD_TO_CHANGE },
		{ status: 400 },
	)
}

/**
 * The row changed since the person saw it, so nothing was saved. The answer
 * carries the row as it is now, so the page can show it and a second save
 * applies to what they have seen.
 */
async function rowChanged(householdId: string, itemId: string) {
	const item = await prisma.shoppingListItem.findFirst({
		where: { id: itemId, list: { householdId } },
		include: { mealContributions: { select: { quantity: true, unit: true } } },
	})
	if (!item) throw new Response('Item not found', { status: 404 })
	const parts = item.mealContributions.map((c) => ({
		amount: c.quantity,
		unit: c.unit,
	}))
	return data(
		{
			status: 'conflict' as const,
			item: {
				checkVersion: item.checkVersion,
				checked: item.checked,
				display: combineRowDisplay({
					...item,
					contributions: item.mealContributions,
				}),
				// On a row with its own amount the editor holds only that amount,
				// so the page also says how much of the total is from Meals.
				mealShare:
					keepsOwnAmount(item.source) && parts.length > 0
						? combineDemandParts(parts)
						: null,
			},
		},
		{ status: 409 },
	)
}
