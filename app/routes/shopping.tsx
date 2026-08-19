import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	Form,
	Link,
	useFetcher,
	useFetchers,
	useRevalidator,
} from 'react-router'
import { toast } from 'sonner'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { ShoppingListToInventory } from '#app/components/shopping-list-to-inventory.tsx'
import { ShoppingListLiveRefresh } from '#app/components/shopping-live-refresh.tsx'
import { MobileFabAdd } from '#app/components/shopping-mobile-fab.tsx'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
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
import { cn } from '#app/utils/misc.tsx'
import { parseTypedItem } from '#app/utils/parse-speech-item.ts'
import {
	buildInventoryLookup,
	findInventoryMatch,
	getCanonicalIngredientName,
	ingredientMatchesAnyInventoryItem,
} from '#app/utils/recipe-matching.server.ts'
import { buildShoppingDemand } from '#app/utils/shopping-demand.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import {
	ShoppingListItemSchema,
	guessCategory,
} from '#app/utils/shopping-list-validation.ts'
import { annotateInventoryMatches } from '#app/utils/shopping-list.server.ts'
import {
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
	const shoppingList = {
		...ensuredShoppingList,
		items: await prisma.shoppingListItem.findMany({
			where: { listId: ensuredShoppingList.id },
			orderBy: [{ checked: 'asc' }],
		}),
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

	// Pro-only: review panel matching. Same fuzzy matcher that computes the
	// rows' inStock flag — canonical-name equality here used to disagree with
	// it on the same screen ("persian cucumber" struck through as usually on
	// hand, then re-created next to "cucumber" in the pantry).
	let alreadyStockedItemIds: string[] = []

	if (isProActive) {
		const allInventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
			select: { id: true, name: true },
		})

		const inventoryLookup = buildInventoryLookup(allInventoryItems)
		alreadyStockedItemIds = shoppingList.items
			.filter((item) =>
				ingredientMatchesAnyInventoryItem({ name: item.name }, inventoryLookup),
			)
			.map((item) => item.id)
	}

	return {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		alreadyStockedItemIds,
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

		// Annotate lines with inventory match info (staples still stripped)
		const inventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})
		const { lines, inStockCount } = annotateInventoryMatches(
			demand,
			inventoryItems,
		)

		// Delete existing generated items — except rows a Meal contribution
		// currently feeds: contributions are durable recovery data (#108), so
		// week-wide regeneration must not destroy one-Meal provenance.
		await prisma.shoppingListItem.deleteMany({
			where: {
				listId: shoppingList.id,
				source: 'generated',
				mealContributions: { none: {} },
			},
		})

		// Dedup against all existing items (checked or not) to avoid visual duplicates
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id },
			select: { name: true },
		})
		const existingCanonicals = new Set(
			existingItems.map((i) => getCanonicalIngredientName(i.name)),
		)
		const dedupedItems = lines.filter(
			(line) => !existingCanonicals.has(line.canonicalName),
		)

		// Create new items — in-stock items are pre-checked
		await prisma.shoppingListItem.createMany({
			data: dedupedItems.map(({ inStock, canonicalName, ...line }) => ({
				...line,
				checked: inStock,
				source: 'generated',
				listId: shoppingList.id,
			})),
		})

		void emitHouseholdEvent({
			type: 'shopping_list_generated',
			payload: { count: dedupedItems.length },
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

		if (!force) {
			const canonicalName = getCanonicalIngredientName(name)

			// Check for existing unchecked shopping list items
			const existingItems = await prisma.shoppingListItem.findMany({
				where: { listId: shoppingList.id, checked: false },
			})
			const duplicate = existingItems.find(
				(item) => getCanonicalIngredientName(item.name) === canonicalName,
			)
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
				}
			}

			// Check inventory
			const inventoryItems = await prisma.inventoryItem.findMany({
				where: { householdId },
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

		await prisma.shoppingListItem.update({
			where: { id: itemId },
			data: {
				name: submission.value.name,
				quantity: submission.value.quantity,
				unit: submission.value.unit,
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_edited',
			payload: { name: submission.value.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'clear-checked') {
		await prisma.shoppingListItem.deleteMany({
			where: {
				listId: shoppingList.id,
				checked: true,
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

		// Dedup against all existing items — and within the batch — by
		// canonical identity, the same rule every entry point uses.
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id },
			select: { name: true },
		})
		const existingCanonicals = new Set(
			existingItems.map((item) => getCanonicalIngredientName(item.name)),
		)
		const newItems = demandLines.filter((line) => {
			if (existingCanonicals.has(line.canonicalName)) return false
			existingCanonicals.add(line.canonicalName)
			return true
		})

		if (newItems.length > 0) {
			await prisma.shoppingListItem.createMany({
				data: newItems.map(({ canonicalName, ...line }) => ({
					...line,
					listId: shoppingList.id,
					source: 'manual' as const,
				})),
			})

			void emitHouseholdEvent({
				type: 'shopping_list_item_added',
				payload: { count: newItems.length, source: 'voice' },
				userId,
				householdId,
			})
		}

		return { status: 'success' as const, addedCount: newItems.length }
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
function usePendingShoppingItems(listId: string): ShoppingListItem[] {
	const fetchers = useFetchers()
	const pending: ShoppingListItem[] = []
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
				}),
			)
		} else if (intent === 'bulk-add') {
			const raw = fetcher.formData.get('items')
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

export default function ShoppingListRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		alreadyStockedItemIds,
		isProActive,
	} = loaderData
	const alreadyStockedIds = new Set(alreadyStockedItemIds)
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
	const [showReview, setShowReview] = useState(false)
	const [quickAddOpen, setQuickAddOpen] = useState(false)
	const [fabOpen, setFabOpen] = useState(false)
	const [warningDismissed, setWarningDismissed] = useState(false)
	const [voiceAddedNames, setVoiceAddedNames] = useState<Set<string>>(new Set())

	// Auto-clear voice highlights after 60 seconds
	useEffect(() => {
		if (voiceAddedNames.size === 0) return
		const timer = setTimeout(() => setVoiceAddedNames(new Set()), 60_000)
		return () => clearTimeout(timer)
	}, [voiceAddedNames])

	const bulkAddFetcher = useFetcher()
	const revalidator = useRevalidator()

	// Revalidate after bulk-add completes so the new items appear
	const prevBulkState = useRef(bulkAddFetcher.state)
	useEffect(() => {
		if (prevBulkState.current !== 'idle' && bulkAddFetcher.state === 'idle') {
			void revalidator.revalidate()
		}
		prevBulkState.current = bulkAddFetcher.state
	}, [bulkAddFetcher.state, revalidator])

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
				toast.success(
					heard
						? `Heard: "${heard}" — added ${items.length} items`
						: `Added ${items.length} items`,
				)
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
	const checkedItemsList = allItems.filter((item) => item.checked)
	const checkedItems = checkedItemsList.length

	const searchLower = search.toLowerCase()
	const filteredItems = search
		? allItems.filter((i) => i.name.toLowerCase().includes(searchLower))
		: allItems

	// Determine if we should show a warning (from quick-add fetcher, not route actionData)
	const showWarning =
		!warningDismissed &&
		quickAddFetcher.data &&
		'warningType' in quickAddFetcher.data &&
		quickAddFetcher.data.status === 'warning'

	return (
		<div className="pb-28 md:pb-6">
			{isProActive && <ShoppingListLiveRefresh />}
			{/* Page Header */}
			<div className="border-border/50 border-b">
				<div className="container-narrow py-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<h1 className="font-serif text-2xl font-normal">
							Shopping List
							{totalItems > 0 && (
								<span className="text-muted-foreground ml-2 font-sans text-lg font-normal tabular-nums">
									({checkedItems}/{totalItems})
								</span>
							)}
						</h1>
						<div className="flex items-center gap-2 sm:ml-auto">
							{hasMealPlan && (
								<Form method="POST" className="flex items-center gap-2">
									<input type="hidden" name="intent" value="generate" />
									<input type="hidden" name="weekStart" value={defaultWeek} />
									<Button
										type="submit"
										variant="outline"
										size="sm"
										aria-label="Generate shopping list from meal plan"
									>
										<Icon name="calendar" size="sm" />
										From Plan
									</Button>
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
				{shoppingList.items.length > 0 &&
					shoppingList.items.every((i) => !i.checked) && (
						<OnboardingNudge
							nudgeId="check-items-off"
							icon="check"
							title="Check items off as you shop"
							description="Tap items as you shop. When you're done, remember anything you usually keep around."
							dismissText="Got it"
							className="mb-4"
						/>
					)}

				{/* Quick Add — desktop only, FAB replaces this on mobile */}
				<div className="border-border/30 mb-2 hidden border-b md:block">
					{/* Warning banner */}
					{showWarning && (
						<WarningBanner
							actionData={quickAddFetcher.data as Record<string, unknown>}
							onDismiss={() => setWarningDismissed(true)}
						/>
					)}

					<quickAddFetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!qaName.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="add" />
						{showWarning && <input type="hidden" name="force" value="true" />}
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
								aria-label={showWarning ? 'Add anyway' : 'Add to list'}
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

				{/* Item List */}
				{totalItems > 0 ? (
					<div className="mt-2">
						{search && filteredItems.length === 0 ? (
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
							<div className="divide-border/40 divide-y">
								{filteredItems.map((item) => (
									<ShoppingListItemCard
										key={item.id}
										item={item}
										isVoiceAdded={voiceAddedNames.has(
											item.name.toLowerCase().trim(),
										)}
									/>
								))}
							</div>
						)}

						{/* Checked Item Actions */}
						{checkedItems > 0 && !showReview && !search && (
							<div className="animate-slide-up-reveal flex items-center justify-center gap-4 pt-4">
								{isProActive && (
									<>
										<button
											type="button"
											onClick={() => setShowReview(true)}
											className="text-primary hover:text-primary/80 text-sm underline underline-offset-2"
										>
											Remember for next time ({checkedItems})
										</button>
										<span className="text-border">·</span>
									</>
								)}
								<Form
									method="POST"
									className="inline"
									onSubmit={(e) => {
										if (
											!confirm(
												`Clear ${checkedItems} checked item${checkedItems !== 1 ? 's' : ''}?`,
											)
										) {
											e.preventDefault()
										}
									}}
								>
									<input type="hidden" name="intent" value="clear-checked" />
									<button
										type="submit"
										className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
									>
										Clear checked
									</button>
								</Form>
							</div>
						)}
					</div>
				) : (
					<div className="py-12 text-center">
						<div className="border-border mx-auto flex size-16 items-center justify-center rounded-full border-2 border-dashed">
							<Icon name="cart" className="text-muted-foreground/40 size-7" />
						</div>
						<h2 className="mt-4 font-serif text-lg">Nothing on the list</h2>
						<p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
							{hasMealPlan ? (
								<>
									Hit <strong>From Plan</strong> to generate your list from the
									meal plan. Usually-on-hand items are pre-checked. Add anything
									else by hand.
								</>
							) : (
								<>
									Create a{' '}
									<Link
										to="/plan"
										className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
									>
										meal plan
									</Link>{' '}
									to auto-generate your list, or add items by hand.
								</>
							)}
						</p>
					</div>
				)}

				{/* Pantry Review Panel (Pro) */}
				{isProActive && showReview && checkedItems > 0 && !search && (
					<div className="mt-4">
						<ShoppingListToInventory
							items={checkedItemsList}
							alreadyStockedIds={alreadyStockedIds}
							onCancel={() => setShowReview(false)}
						/>
					</div>
				)}
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
