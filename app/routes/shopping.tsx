import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	Form,
	Link,
	useFetcher,
	useFetchers,
	useNavigation,
	useRevalidator,
} from 'react-router'
import { toast } from 'sonner'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { ShoppingListLiveRefresh } from '#app/components/shopping-live-refresh.tsx'
import { MobileFabAdd } from '#app/components/shopping-mobile-fab.tsx'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { PendingButton } from '#app/components/ui/pending-button.tsx'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import {
	getCurrentWeekStart,
	getPreviousWeek,
	getNextWeek,
	getWeekStart,
	parseDate,
	serializeDate,
	formatWeekRange,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { activeLegacyPantryWhere } from '#app/utils/legacy-pantry.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { parseTypedItem } from '#app/utils/parse-speech-item.ts'
import {
	buildInventoryLookup,
	findInventoryMatch,
} from '#app/utils/recipe-matching.server.ts'
import {
	editShoppingDisplayGroup,
	removeGeneratedShoppingAmount,
} from '#app/utils/shopping-contribution.server.ts'
import {
	buildShoppingDemand,
	combineRowDisplay,
	demandIdentity,
} from '#app/utils/shopping-demand.server.ts'
import { resolveNextShopDemandTargets } from '#app/utils/shopping-horizon.server.ts'
import {
	LATER,
	NEXT_SHOP,
	parseShoppingHorizon,
	type ShoppingHorizon,
} from '#app/utils/shopping-horizon.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import {
	ShoppingListItemSchema,
	guessCategory,
} from '#app/utils/shopping-list-validation.ts'
import {
	annotateShoppingDemand,
	loadShoppingAvailability,
} from '#app/utils/shopping-list.server.ts'
import {
	type DisplayShoppingItem,
	makeOptimisticShoppingItem,
	mergeOptimisticShoppingItems,
} from '#app/utils/shopping-optimistic.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/shopping.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Shopping List | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, isProActive } =
		await requireUserWithTier(request)

	const ensuredShoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
	})
	// Each row ships with a display quantity grouped from its current Meal
	// contributions (#109) — computed here, never written back: manual rows
	// and contributions both keep their stored identities.
	const rowsWithContributions = await prisma.shoppingListItem.findMany({
		where: { listId: ensuredShoppingList.id },
		orderBy: [{ checked: 'asc' }],
		include: {
			mealContributions: { select: { quantity: true, unit: true } },
		},
	})
	const shoppingList = {
		...ensuredShoppingList,
		items: rowsWithContributions.map(({ mealContributions, ...item }) => ({
			...item,
			display: combineRowDisplay({
				source: item.source,
				quantity: item.quantity,
				unit: item.unit,
				contributions: mealContributions,
			}),
		})),
	}
	// SQLite's name ordering is ASCII-cased ("Shaoxing wine" before
	// "broccoli"); re-sort locale-aware so the flat list reads alphabetical.
	shoppingList.items.sort(
		(a, b) =>
			Number(a.checked) - Number(b.checked) ||
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
	)

	// Check prev/current/next weeks for meal plans
	const currentWeek = getCurrentWeekStart()
	const prevWeek = getPreviousWeek(currentWeek)
	const nextWeek = getNextWeek(currentWeek)

	// A week counts as planned when it has at least one Recipe item — text-only
	// Meals have no Shopping behavior, so a week of only "Leftovers" offers
	// nothing to generate from.
	const mealPlans = await prisma.mealPlan.findMany({
		where: {
			householdId,
			weekStart: { in: [prevWeek, currentWeek, nextWeek] },
		},
		select: {
			weekStart: true,
			meals: {
				where: { recipeItems: { some: {} } },
				select: { id: true },
				take: 1,
			},
		},
	})

	const weeksWithPlans = [prevWeek, currentWeek, nextWeek]
		.filter((week) =>
			mealPlans.some(
				(mp) =>
					mp.weekStart.getTime() === week.getTime() && mp.meals.length > 0,
			),
		)
		.map((week) => ({
			weekStart: serializeDate(week),
			label: formatWeekRange(week),
			isCurrent: week.getTime() === currentWeek.getTime(),
		}))

	const hasMealPlan = weeksWithPlans.length > 0

	return {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		isProActive,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	const shoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
	})

	if (intent === 'generate') {
		// Get meal plan for specified week (or current week)
		const weekStartParam = formData.get('weekStart')
		const weekStart =
			typeof weekStartParam === 'string' && weekStartParam
				? getWeekStart(parseDate(weekStartParam))
				: getCurrentWeekStart()
		// Week-wide generation reads Meal Recipe items (#106): uncooked items
		// scale by their stored batch multiplier. Missing cards (recipeId null)
		// produce no fresh demand, and text-only Meals have no items at all.
		const mealPlan = await prisma.mealPlan.findUnique({
			where: { householdId_weekStart: { householdId, weekStart } },
			include: {
				meals: {
					include: {
						recipeItems: {
							where: { cooked: false },
							include: {
								recipe: {
									include: {
										ingredients: true,
									},
								},
							},
						},
					},
				},
			},
		})

		invariantResponse(mealPlan, 'No meal plan found for this week', {
			status: 404,
		})

		// Week-wide demand through the one pure demand module (#108).
		const demand = buildShoppingDemand({
			recipeBatches: mealPlan.meals
				.flatMap((meal) => meal.recipeItems)
				.flatMap((item) =>
					item.recipe
						? [
								{
									ingredients: item.recipe.ingredients,
									scaleMultiplier: item.scaleMultiplier,
								},
							]
						: [],
				),
		})

		const availability = await loadShoppingAvailability(prisma, householdId)
		const { lines, inStockCount } = annotateShoppingDemand(demand, availability)

		// Delete existing generated items — except rows a Meal contribution
		// currently feeds: contributions are durable recovery data (#108), so
		// week-wide regeneration must not destroy one-Meal provenance.
		await prisma.shoppingListItem.deleteMany({
			where: {
				listId: shoppingList.id,
				source: 'generated',
				checked: false,
				horizon: NEXT_SHOP,
				mealContributions: { none: {} },
			},
		})

		// Generated demand always targets Next shop. An unchecked Later match is
		// promoted in place; checked matches keep their already-bought state.
		const { targets, promotedIds } = await resolveNextShopDemandTargets(
			prisma,
			{
				listId: shoppingList.id,
				canonicalNames: lines.map((line) => line.canonicalName),
			},
		)
		const dedupedItems = lines.filter(
			(line) => !targets.has(line.canonicalName),
		)

		// Create new items — in-stock items are pre-checked
		await prisma.shoppingListItem.createMany({
			data: dedupedItems.map(
				({ inStock, canonicalName, fromNote, ...line }) => ({
					...line,
					checked: inStock,
					source: 'generated',
					horizon: NEXT_SHOP,
					listId: shoppingList.id,
				}),
			),
		})

		void emitHouseholdEvent({
			type: 'shopping_list_generated',
			payload: { count: dedupedItems.length + promotedIds.length },
			userId,
			householdId,
		})

		return {
			status: 'success' as const,
			inStockCount,
			weekLabel: formatWeekRange(weekStart),
		}
	}

	if (intent === 'add') {
		const submission = parseWithZod(formData, {
			schema: ShoppingListItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		const force = formData.get('force') === 'true'
		const horizon = parseShoppingHorizon(formData.get('horizon'))

		// "2 lemons" typed into the bare input becomes qty 2 + "lemons" (E4).
		// Only when no explicit quantity came along — the Qty & unit fields win.
		// Parsing happens before the duplicate/inventory checks so "2 lemons"
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

		if (!force) {
			if (duplicate) {
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

			// Check inventory
			const inventoryItems = await prisma.inventoryItem.findMany({
				where: activeLegacyPantryWhere(householdId),
			})
			const inInventory = findInventoryMatch(
				{ name },
				buildInventoryLookup(inventoryItems),
			)
			if (inInventory) {
				return {
					status: 'warning' as const,
					warningType: 'in_inventory' as const,
					inventoryName: inInventory.name,
					submittedName: name,
					submittedQuantity: quantity,
					submittedUnit: unit,
				}
			}
		}

		// Auto-categorize if no category provided
		const category = submission.value.category || guessCategory(name)

		await prisma.shoppingListItem.create({
			data: {
				name,
				quantity,
				unit,
				category,
				listId: shoppingList.id,
				source: 'manual',
				horizon,
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_added',
			payload: { name },
			userId,
			householdId,
		})

		return {
			status: 'success' as const,
			submission: submission.reply({ resetForm: true }),
		}
	}

	if (intent === 'toggle') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
			},
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.shoppingListItem.update({
			where: { id: itemId },
			data: { checked: !item.checked },
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_toggled',
			payload: { name: item.name, checked: !item.checked },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'move') {
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
			type: 'shopping_list_item_edited',
			payload: { name: item.name, horizon },
			userId,
			householdId,
		})
		return { status: 'success' as const, moved: 1, horizon }
	}

	if (intent === 'move-items') {
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
				type: 'shopping_list_item_edited',
				payload: { count: result.count, horizon },
				userId,
				householdId,
			})
		}
		return { status: 'success' as const, moved: result.count, horizon }
	}

	if (intent === 'delete') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
			},
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.shoppingListItem.delete({ where: { id: itemId } })

		void emitHouseholdEvent({
			type: 'shopping_list_item_deleted',
			payload: { name: item.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'edit') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
			},
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		const submission = parseWithZod(formData, {
			schema: ShoppingListItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		await editShoppingDisplayGroup(prisma, {
			itemId,
			name: submission.value.name,
			quantity: submission.value.quantity ?? null,
			unit: submission.value.unit ?? null,
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_edited',
			payload: { name: submission.value.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'removeGeneratedAmount') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')
		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
				source: 'manual',
				mealContributions: { some: {} },
			},
		})
		invariantResponse(item, 'Mixed Shopping group not found', { status: 404 })

		await removeGeneratedShoppingAmount(prisma, { itemId })
		void emitHouseholdEvent({
			type: 'shopping_list_item_edited',
			payload: { name: item.name },
			userId,
			householdId,
		})
		return { status: 'success' as const }
	}

	if (intent === 'clear-checked') {
		const horizon = parseShoppingHorizon(formData.get('horizon'))
		await prisma.shoppingListItem.deleteMany({
			where: {
				listId: shoppingList.id,
				checked: true,
				horizon,
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_cleared',
			payload: {},
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'bulk-add') {
		const rawItems = formData.get('items')
		invariantResponse(typeof rawItems === 'string', 'Items are required')

		let items: Array<{ name: string; quantity?: string; unit?: string }>
		try {
			items = JSON.parse(rawItems) as typeof items
		} catch {
			throw new Response('Invalid items data', { status: 400 })
		}
		invariantResponse(Array.isArray(items) && items.length > 0, 'No items')

		// Ordinary note Shopping lines through the demand module (#108): trims
		// and normalizes each line's identity while preserving the free text.
		const demandLines = buildShoppingDemand({ noteLines: items })
		const horizon = parseShoppingHorizon(formData.get('horizon'))

		// Dedup against all existing items and within the batch. Unchecked
		// cross-section matches are returned as explicit move offers.
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
	}

	return { status: 'error' as const }
}

/**
 * Optimistically render items from in-flight `add` / `bulk-add` submissions so a
 * newly added item appears instantly instead of waiting for the server round-trip
 * + revalidation. Reads every shopping fetcher via useFetchers, so it captures all
 * add entry points at once (desktop quick-add, mobile FAB, voice bulk-add). Items
 * show only while the fetcher is non-idle; by the time it returns to idle the
 * fetcher's own revalidation has landed the real row, and the merge dedups by name
 * to avoid a duplicate during any overlap (e.g. a concurrent SSE revalidation).
 */
function usePendingShoppingItems(listId: string): DisplayShoppingItem[] {
	const fetchers = useFetchers()
	const pending: DisplayShoppingItem[] = []
	for (const fetcher of fetchers) {
		if (fetcher.state === 'idle' || !fetcher.formData) continue
		const intent = fetcher.formData.get('intent')
		if (intent === 'add') {
			const name = String(fetcher.formData.get('name') ?? '')
			if (!name.trim()) continue
			pending.push(
				makeOptimisticShoppingItem({
					name,
					quantity: fetcher.formData.get('quantity') as string | null,
					unit: fetcher.formData.get('unit') as string | null,
					listId,
					horizon: parseShoppingHorizon(fetcher.formData.get('horizon')),
				}),
			)
		} else if (intent === 'bulk-add') {
			const raw = fetcher.formData.get('items')
			const horizon = parseShoppingHorizon(fetcher.formData.get('horizon'))
			if (typeof raw !== 'string') continue
			try {
				const items = JSON.parse(raw) as Array<{
					name?: string
					quantity?: string
					unit?: string
				}>
				for (const item of items) {
					if (!item?.name?.trim()) continue
					pending.push(
						makeOptimisticShoppingItem({
							name: item.name,
							quantity: item.quantity ?? null,
							unit: item.unit ?? null,
							listId,
							horizon,
						}),
					)
				}
			} catch {
				// Ignore malformed bulk payloads — the server rejects them too.
			}
		}
	}
	return pending
}

function LaterQuickAdd() {
	const fetcher = useFetcher<Record<string, unknown>>()
	const [name, setName] = useState('')
	const [warningDismissed, setWarningDismissed] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const previousState = useRef(fetcher.state)

	useEffect(() => {
		if (
			previousState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data?.status === 'success'
		) {
			setName('')
			setWarningDismissed(false)
			inputRef.current?.focus()
		}
		previousState.current = fetcher.state
	}, [fetcher.state, fetcher.data])

	const warningData =
		fetcher.data &&
		'warningType' in fetcher.data &&
		fetcher.data.status === 'warning'
			? fetcher.data
			: null
	const showWarning = !warningDismissed && warningData != null
	const canForce = showWarning && warningData.warningType !== 'move_to_section'

	return (
		<div className="border-border/40 border-b py-2">
			{showWarning && (
				<WarningBanner
					actionData={warningData}
					onDismiss={() => setWarningDismissed(true)}
					onMoved={() => setName('')}
				/>
			)}
			<fetcher.Form
				method="POST"
				onSubmit={(event) => {
					if (!name.trim()) event.preventDefault()
				}}
				className="flex items-center gap-2"
			>
				<input type="hidden" name="intent" value="add" />
				<input type="hidden" name="horizon" value={LATER} />
				{canForce && <input type="hidden" name="force" value="true" />}
				<Input
					ref={inputRef}
					name="name"
					value={name}
					onChange={(event) => {
						setName(event.target.value)
						setWarningDismissed(false)
					}}
					placeholder="Add for later..."
					className="h-9 min-w-0 flex-1"
				/>
				<button
					type="submit"
					disabled={!name.trim() || fetcher.state !== 'idle'}
					className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
					aria-label={canForce ? 'Add to Later anyway' : 'Add for later'}
				>
					<Icon name="plus" className="size-5" />
				</button>
			</fetcher.Form>
		</div>
	)
}

function ShoppingItems({
	items,
	voiceAddedNames,
}: {
	items: DisplayShoppingItem[]
	voiceAddedNames: Set<string>
}) {
	return (
		<div className="divide-border/40 divide-y">
			{items.map((item) => (
				<ShoppingListItemCard
					key={item.id}
					item={item}
					isVoiceAdded={voiceAddedNames.has(item.name.toLowerCase().trim())}
				/>
			))}
		</div>
	)
}

function ClearCheckedControl({
	checkedCount,
	horizon,
	pending,
}: {
	checkedCount: number
	horizon: ShoppingHorizon
	pending: boolean
}) {
	if (checkedCount === 0) return null
	const sectionLabel = horizon === LATER ? 'Later' : 'Next shop'
	return (
		<div className="animate-slide-up-reveal flex items-center justify-center pt-4">
			<Form
				method="POST"
				className="inline"
				onSubmit={(event) => {
					if (
						!confirm(
							`Clear ${checkedCount} checked item${checkedCount !== 1 ? 's' : ''} from ${sectionLabel}?`,
						)
					) {
						event.preventDefault()
					}
				}}
			>
				<input type="hidden" name="intent" value="clear-checked" />
				<input type="hidden" name="horizon" value={horizon} />
				<PendingButton
					type="submit"
					variant="link"
					pending={pending}
					pendingLabel={`Clearing checked items from ${sectionLabel}`}
					aria-label={`Clear checked items from ${sectionLabel}`}
					className="text-muted-foreground hover:text-foreground h-auto p-0 text-sm underline underline-offset-2"
				>
					Clear checked
				</PendingButton>
			</Form>
		</div>
	)
}

export default function ShoppingListRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { shoppingList, hasMealPlan, weeksWithPlans, isProActive } = loaderData
	const defaultWeek =
		weeksWithPlans.find((w) => w.isCurrent)?.weekStart ??
		weeksWithPlans[0]?.weekStart ??
		''
	// Quick-add uses fetcher so form state survives SSE-triggered revalidations
	const quickAddFetcher = useFetcher<Record<string, unknown>>()
	const [qaName, setQaName] = useState('')
	const [qaQuantity, setQaQuantity] = useState('')
	const [qaUnit, setQaUnit] = useState('')
	const qaInputRef = useRef<HTMLInputElement>(null)

	const [search, setSearch] = useState('')
	const [laterExpanded, setLaterExpanded] = useState(false)
	const [quickAddOpen, setQuickAddOpen] = useState(false)
	const [fabOpen, setFabOpen] = useState(false)
	const [warningDismissed, setWarningDismissed] = useState(false)
	const [voiceAddedNames, setVoiceAddedNames] = useState<Set<string>>(new Set())
	const navigation = useNavigation()
	const pendingIntent = navigation.formData?.get('intent')
	const isGeneratingFromPlan =
		navigation.state !== 'idle' && pendingIntent === 'generate'
	const isClearingChecked =
		navigation.state !== 'idle' && pendingIntent === 'clear-checked'
	const clearingHorizon = parseShoppingHorizon(
		navigation.formData?.get('horizon') ?? null,
	)

	// Auto-clear voice highlights after 60 seconds
	useEffect(() => {
		if (voiceAddedNames.size === 0) return
		const timer = setTimeout(() => setVoiceAddedNames(new Set()), 60_000)
		return () => clearTimeout(timer)
	}, [voiceAddedNames])

	const bulkAddFetcher = useFetcher()
	const moveItemsFetcher = useFetcher()
	const revalidator = useRevalidator()

	// Revalidate after bulk-add completes so the new items appear
	const prevBulkState = useRef(bulkAddFetcher.state)
	useEffect(() => {
		if (prevBulkState.current !== 'idle' && bulkAddFetcher.state === 'idle') {
			void revalidator.revalidate()
			const result = bulkAddFetcher.data as
				{ addedCount?: number; moveItemIds?: string[] } | undefined
			const moveItemIds = result?.moveItemIds ?? []
			if (typeof result?.addedCount === 'number' && result.addedCount > 0) {
				toast.success(
					`Added ${result.addedCount} item${result.addedCount === 1 ? '' : 's'}`,
				)
			}
			if (moveItemIds.length > 0) {
				toast.info(
					`${moveItemIds.length} item${moveItemIds.length === 1 ? ' is' : 's are'} already in Later`,
					{
						action: {
							label: 'Move to Next shop',
							onClick: () => {
								const data = new FormData()
								data.set('intent', 'move-items')
								data.set('itemIds', JSON.stringify(moveItemIds))
								data.set('horizon', NEXT_SHOP)
								void moveItemsFetcher.submit(data, { method: 'POST' })
							},
						},
					},
				)
			}
		}
		prevBulkState.current = bulkAddFetcher.state
	}, [bulkAddFetcher.state, bulkAddFetcher.data, moveItemsFetcher, revalidator])

	const handleSpeechResult = useCallback(
		(items: TranscribedItem[], transcription: string | null) => {
			if (items.length === 1) {
				// Single item: populate the input for review
				const item = items[0]!
				setQaName(item.name)
				if (item.quantity || item.unit) {
					setQaQuantity(item.quantity)
					setQaUnit(item.unit)
					setQuickAddOpen(true)
				}
				if (transcription) {
					toast.info(`Heard: "${transcription}"`)
				}
				qaInputRef.current?.focus()
			} else {
				// Multiple items: bulk-add directly
				const fd = new FormData()
				fd.set('intent', 'bulk-add')
				fd.set('items', JSON.stringify(items))
				fd.set('horizon', NEXT_SHOP)
				void bulkAddFetcher.submit(fd, { method: 'POST' })
				setVoiceAddedNames(
					(prev) =>
						new Set([
							...prev,
							...items.map((i) => i.name.toLowerCase().trim()),
						]),
				)
				const heard =
					transcription &&
					(transcription.length > 60
						? transcription.slice(0, 60) + '…'
						: transcription)
				if (heard) toast.info(`Heard: "${heard}"`)
			}
		},
		[bulkAddFetcher],
	)
	const handleMobileVoiceItems = useCallback((names: string[]) => {
		setVoiceAddedNames(
			(prev) => new Set([...prev, ...names.map((n) => n.toLowerCase().trim())]),
		)
	}, [])
	const handleSpeechError = useCallback((msg: string) => toast.error(msg), [])
	const { isRecording, isTranscribing, startRecording, stopRecording } =
		useSpeechToText({
			onResult: handleSpeechResult,
			onError: handleSpeechError,
		})

	// Reset quick-add on success, preserve values on warning
	const prevQaState = useRef(quickAddFetcher.state)
	useEffect(() => {
		if (
			prevQaState.current !== 'idle' &&
			quickAddFetcher.state === 'idle' &&
			quickAddFetcher.data?.status === 'success'
		) {
			setQaName('')
			setQaQuantity('')
			setQaUnit('')
			setWarningDismissed(false)
			qaInputRef.current?.focus()
		}
		prevQaState.current = quickAddFetcher.state
	}, [quickAddFetcher.state, quickAddFetcher.data])

	const pendingAddedItems = usePendingShoppingItems(shoppingList.id)
	const allItems = mergeOptimisticShoppingItems(
		shoppingList.items,
		pendingAddedItems,
	)
	const totalItems = allItems.length
	const nextItems = allItems.filter((item) => item.horizon === NEXT_SHOP)
	const laterItems = allItems.filter((item) => item.horizon === LATER)
	const checkedNextItems = nextItems.filter((item) => item.checked).length
	const checkedLaterItems = laterItems.filter((item) => item.checked).length

	const searchLower = search.toLowerCase()
	const filterBySearch = (items: typeof allItems) =>
		search
			? items.filter((item) => item.name.toLowerCase().includes(searchLower))
			: items
	const filteredNextItems = filterBySearch(nextItems)
	const filteredLaterItems = filterBySearch(laterItems)
	const hasSearchResults =
		filteredNextItems.length > 0 || filteredLaterItems.length > 0
	const showLaterContents =
		laterExpanded || (Boolean(search) && filteredLaterItems.length > 0)

	// Determine if we should show a warning (from quick-add fetcher, not route actionData)
	const warningData =
		quickAddFetcher.data &&
		'warningType' in quickAddFetcher.data &&
		quickAddFetcher.data.status === 'warning'
			? quickAddFetcher.data
			: null
	const showWarning = !warningDismissed && warningData != null
	const canForceQuickAdd =
		showWarning && warningData.warningType !== 'move_to_section'

	return (
		<div className="pb-28 md:pb-6">
			{isProActive && <ShoppingListLiveRefresh />}
			{/* Page Header */}
			<div className="border-border/50 border-b">
				<div className="container-narrow py-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<h1 className="font-serif text-2xl font-normal">
							Shopping List
							{nextItems.length > 0 && (
								<>
									<span
										aria-hidden="true"
										className="text-muted-foreground ml-2 font-sans text-lg font-normal tabular-nums"
									>
										({checkedNextItems}/{nextItems.length})
									</span>
									<span className="sr-only">
										, {checkedNextItems} of {nextItems.length} items for this
										shop checked
									</span>
								</>
							)}
						</h1>
						<div className="flex items-center gap-2 sm:ml-auto">
							{hasMealPlan && (
								<Form method="POST" className="flex items-center gap-2">
									<input type="hidden" name="intent" value="generate" />
									<input type="hidden" name="horizon" value={NEXT_SHOP} />
									<input type="hidden" name="weekStart" value={defaultWeek} />
									<PendingButton
										type="submit"
										variant="outline"
										size="sm"
										pending={isGeneratingFromPlan}
										pendingLabel="Generating shopping list"
										aria-label="Generate shopping list from meal plan"
									>
										<Icon name="calendar" size="sm" />
										From Plan
									</PendingButton>
								</Form>
							)}
						</div>
					</div>
				</div>
				{actionData?.status === 'success' && 'weekLabel' in actionData && (
					<p className="text-muted-foreground container-narrow pb-4 text-center text-sm">
						Generated for {actionData.weekLabel}
						{typeof actionData.inStockCount === 'number' &&
							actionData.inStockCount > 0 &&
							` · ${actionData.inStockCount} usually on hand`}
					</p>
				)}
			</div>

			<div className="container-narrow py-4">
				{shoppingList.items.some((item) => item.horizon === NEXT_SHOP) &&
					shoppingList.items
						.filter((item) => item.horizon === NEXT_SHOP)
						.every((item) => !item.checked) && (
						<OnboardingNudge
							nudgeId="check-items-off"
							icon="check"
							title="Check items off as you shop"
							description="Tap items as you shop, then clear the checked rows when you're done."
							dismissText="Got it"
							className="mb-4"
						/>
					)}

				{/* Quick Add — desktop only, FAB replaces this on mobile */}
				<div className="border-border/30 mb-2 hidden border-b md:block">
					{/* Warning banner */}
					{showWarning && (
						<WarningBanner
							actionData={warningData}
							onDismiss={() => setWarningDismissed(true)}
							onMoved={() => {
								setQaName('')
								setQaQuantity('')
								setQaUnit('')
							}}
						/>
					)}

					<quickAddFetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!qaName.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="add" />
						<input type="hidden" name="horizon" value={NEXT_SHOP} />
						{canForceQuickAdd && (
							<input type="hidden" name="force" value="true" />
						)}
						<div className="flex items-center gap-2">
							<div className="min-w-0 flex-1">
								<Input
									ref={qaInputRef}
									name="name"
									value={qaName}
									onChange={(e) => {
										setQaName(e.target.value)
										setWarningDismissed(false)
									}}
									placeholder="Add an item..."
									className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
								/>
							</div>
							{!quickAddOpen && (
								<button
									type="button"
									onClick={() => setQuickAddOpen(true)}
									className="text-muted-foreground/40 hover:text-muted-foreground shrink-0 text-xs"
								>
									+ Qty
								</button>
							)}
							{isProActive && (
								<button
									type="button"
									onClick={isRecording ? stopRecording : startRecording}
									disabled={isTranscribing}
									className={cn(
										'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
										isRecording
											? 'bg-destructive text-destructive-foreground animate-pulse'
											: 'text-muted-foreground hover:bg-muted hover:text-foreground',
									)}
									aria-label={
										isRecording
											? 'Stop recording'
											: isTranscribing
												? 'Transcribing...'
												: 'Voice input'
									}
								>
									{isTranscribing ? (
										<Icon name="update" className="size-4 animate-spin" />
									) : (
										<Icon name="microphone" className="size-4" />
									)}
								</button>
							)}
							<button
								type="submit"
								disabled={!qaName.trim() || quickAddFetcher.state !== 'idle'}
								className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
								aria-label={
									canForceQuickAdd ? 'Add anyway' : 'Add to Next shop'
								}
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
						{quickAddOpen && (
							<div className="flex items-center gap-3 pb-1">
								<div className="min-w-0 flex-1">
									<Input
										name="quantity"
										value={qaQuantity}
										onChange={(e) => setQaQuantity(e.target.value)}
										placeholder="Qty"
										className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<div className="min-w-0 flex-1">
									<Input
										name="unit"
										value={qaUnit}
										onChange={(e) => setQaUnit(e.target.value)}
										placeholder="Unit"
										className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<button
									type="button"
									onClick={() => setQuickAddOpen(false)}
									className="text-muted-foreground/40 hover:text-muted-foreground shrink-0 text-xs"
								>
									Hide
								</button>
							</div>
						)}
					</quickAddFetcher.Form>
				</div>

				{/* Search — only shown with 15+ items */}
				{totalItems >= 15 && (
					<div className="relative mt-2">
						<Icon
							name="magnifying-glass"
							size="sm"
							className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<Input
							type="search"
							placeholder="Search shopping list..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>
				)}

				{search && !hasSearchResults ? (
					<div className="py-12 text-center">
						<p className="text-muted-foreground text-sm">
							No items matching &ldquo;{search}&rdquo;
						</p>
						<button
							type="button"
							className="text-primary mt-2 text-sm underline underline-offset-2"
							onClick={() => setSearch('')}
						>
							Clear search
						</button>
					</div>
				) : (
					<>
						<div
							className="mt-2"
							data-shopping-horizon={NEXT_SHOP}
							data-testid="next-shopping-items"
						>
							{filteredNextItems.length > 0 ? (
								<ShoppingItems
									items={filteredNextItems}
									voiceAddedNames={voiceAddedNames}
								/>
							) : !search ? (
								<div className="py-10 text-center">
									<div className="border-border mx-auto flex size-14 items-center justify-center rounded-full border-2 border-dashed">
										<Icon
											name="cart"
											className="text-muted-foreground/40 size-6"
										/>
									</div>
									<h3 className="mt-3 font-serif text-lg">
										Nothing for the next shop
									</h3>
									<p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
										{hasMealPlan ? (
											<>
												Use <strong>From Plan</strong> or add an item by hand.
											</>
										) : (
											<>
												Create a{' '}
												<Link
													to="/plan"
													className="text-primary font-medium underline underline-offset-2"
												>
													meal plan
												</Link>{' '}
												or add an item by hand.
											</>
										)}
									</p>
								</div>
							) : null}
							{!search && (
								<ClearCheckedControl
									checkedCount={checkedNextItems}
									horizon={NEXT_SHOP}
									pending={isClearingChecked && clearingHorizon === NEXT_SHOP}
								/>
							)}
						</div>
					</>
				)}

				<section className="border-border/50 mt-8 border-t pt-3">
					<button
						type="button"
						className="hover:bg-muted/50 flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left"
						onClick={() => setLaterExpanded((expanded) => !expanded)}
						aria-expanded={showLaterContents}
						aria-controls="later-shopping-items"
					>
						<Icon
							name="chevron-down"
							size="sm"
							className={cn(
								'text-muted-foreground transition-transform',
								showLaterContents && 'rotate-180',
							)}
						/>
						<h2 className="font-serif text-lg">Later</h2>
						<span className="text-muted-foreground text-sm tabular-nums">
							({laterItems.length})
						</span>
						{checkedLaterItems > 0 && (
							<span className="text-muted-foreground ml-auto text-xs tabular-nums">
								{checkedLaterItems} checked
							</span>
						)}
					</button>
					{showLaterContents && (
						<div
							id="later-shopping-items"
							className="pl-1"
							data-shopping-horizon={LATER}
						>
							{!search && <LaterQuickAdd />}
							{filteredLaterItems.length > 0 ? (
								<ShoppingItems
									items={filteredLaterItems}
									voiceAddedNames={voiceAddedNames}
								/>
							) : (
								<p className="text-muted-foreground py-6 text-center text-sm">
									Nothing saved for later.
								</p>
							)}
							{!search && (
								<ClearCheckedControl
									checkedCount={checkedLaterItems}
									horizon={LATER}
									pending={isClearingChecked && clearingHorizon === LATER}
								/>
							)}
						</div>
					)}
				</section>
			</div>

			{/* Mobile FAB + quick-add popover */}
			<MobileFabAdd
				open={fabOpen}
				onOpenChange={setFabOpen}
				isProActive={isProActive}
				onVoiceItemsAdded={handleMobileVoiceItems}
			/>
		</div>
	)
}
