import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useCallback, useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { OfflineErrorBoundary } from '#app/components/offline-error-boundary.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { useHiddenRows } from '#app/components/undo-delete.tsx'
import { ShoppingListLiveRefresh } from '#app/components/shopping-live-refresh.tsx'
import { MobileFabAdd } from '#app/components/shopping-mobile-fab.tsx'
import { ShoppingPlanPicker } from '#app/components/shopping-plan-picker.tsx'
import {
	ClearCheckedControl,
	LaterQuickAdd,
	ShoppingItems,
} from '#app/components/shopping-section.tsx'
import { ShoppingStaplesPicker } from '#app/components/shopping-staples-picker.tsx'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { usePendingShoppingItems } from '#app/hooks/use-pending-shopping-items.ts'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import {
	getPreviousWeek,
	getNextWeek,
	getWeekStart,
	parseDate,
	serializeDate,
	formatWeekRange,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	combineRowDisplay,
	demandIdentity,
} from '#app/utils/shopping-demand.server.ts'
import { LATER, NEXT_SHOP } from '#app/utils/shopping-horizon.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { mergeOptimisticShoppingItems } from '#app/utils/shopping-optimistic.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { useShoppingChecks } from '#app/hooks/use-shopping-checks.tsx'
import {
	getHouseholdClientId,
	HouseholdClientInput,
} from '#app/utils/household-client.tsx'
import { staleWhileRevalidate } from '#app/utils/loader-cache.ts'
import { useStaleRevalidate } from '#app/utils/use-stale-revalidate.ts'
import { type Route } from './+types/shopping.ts'
import { shoppingActions } from './shopping-action.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Shopping | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, isProActive } =
		await requireUserWithTier(request)

	const ensuredShoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
	})
	// Each row ships with a display quantity grouped from its current Meal
	// contributions. It is computed here and never written back, so manual
	// rows and contributions both keep their stored values.
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

	// Check prev/current/next weeks for meal plans. "Current" is the week of
	// the browser's today.
	const today = getRequestToday(request)
	const currentWeek = getWeekStart(parseDate(today))
	const prevWeek = getPreviousWeek(currentWeek)
	const nextWeek = getNextWeek(currentWeek)

	// A week counts as planned when one of its Meals can contribute Shopping
	// demand: a Recipe item or a note card's Shopping lines. Text-only Meals
	// put nothing on Shopping, so a week of only "Leftovers" has nothing to
	// offer the picker.
	const mealPlans = await prisma.mealPlan.findMany({
		where: {
			householdId,
			weekStart: { in: [prevWeek, currentWeek, nextWeek] },
		},
		select: {
			weekStart: true,
			meals: {
				where: {
					genericText: null,
					OR: [
						{ recipeItems: { some: {} } },
						{ noteItems: { some: { shoppingLines: { some: {} } } } },
					],
				},
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
			label: formatWeekRange(week, today),
			isCurrent: week.getTime() === currentWeek.getTime(),
		}))

	const hasMealPlan = weeksWithPlans.length > 0
	const shoppingIdentities = [
		...new Set(shoppingList.items.map((item) => demandIdentity(item.name))),
	]
	return {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		isProActive,
		shoppingIdentities,
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

	if (typeof intent === 'string' && Object.hasOwn(shoppingActions, intent)) {
		return shoppingActions[intent as keyof typeof shoppingActions]({
			formData,
			userId,
			householdId,
			shoppingList,
		})
	}

	// An intent this page doesn't send, such as delete or Clear checked from a
	// tab opened before Undo (those go to resources/undo-delete). It saves
	// nothing, and the status says so; a 200 would read as done.
	return data({ status: 'error' as const }, { status: 400 })
}

export const ErrorBoundary = OfflineErrorBoundary

// Shows the last data for this URL at once on a navigation and revalidates
// behind it; see loader-cache.ts.
export async function clientLoader(args: Route.ClientLoaderArgs) {
	return staleWhileRevalidate(args)
}
clientLoader.hydrate = false as const

export default function ShoppingListRoute({
	loaderData,
}: Route.ComponentProps) {
	useStaleRevalidate(loaderData)
	const {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		isProActive,
		shoppingIdentities,
	} = loaderData
	const checks = useShoppingChecks(shoppingList.items, shoppingList.id)
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
				| { addedCount?: number; moveItemIds?: string[]; message?: string }
				| undefined
			if (result?.message) toast.error(result.message)
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
								data.set('originClientId', getHouseholdClientId())
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
				fd.set('originClientId', getHouseholdClientId())
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
	// Rows deleted with Undo still waiting stay in the lists, collapsed, so
	// Undo can open them again; nothing counts them.
	const hidden = useHiddenRows()
	const listedItems = mergeOptimisticShoppingItems(
		checks.items,
		pendingAddedItems,
	)
	const allItems = listedItems.filter((item) => !hidden.has(item.id))
	const totalItems = allItems.length
	const nextItems = allItems.filter((item) => item.horizon === NEXT_SHOP)
	const laterItems = allItems.filter((item) => item.horizon === LATER)
	const clearable = (items: typeof allItems) =>
		items.filter((item) => item.checked && !checks.pendingIds.includes(item.id))
	const clearableNext = clearable(nextItems)
	const clearableLater = clearable(laterItems)
	const checkedNextItems = clearableNext.length
	const checkedLaterItems = clearableLater.length

	const searchLower = search.toLowerCase()
	const filterBySearch = (items: typeof allItems) =>
		search
			? items.filter((item) => item.name.toLowerCase().includes(searchLower))
			: items
	const filteredNextItems = filterBySearch(nextItems)
	const filteredLaterItems = filterBySearch(laterItems)
	// What the lists render: the visible rows plus the collapsed ones.
	const listedNextItems = filterBySearch(
		listedItems.filter((item) => item.horizon === NEXT_SHOP),
	)
	const listedLaterItems = filterBySearch(
		listedItems.filter((item) => item.horizon === LATER),
	)
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
		<div className="pb-[calc(var(--bottom-nav-h)+3rem+var(--bottom-nav-inset))] md:pb-6">
			{isProActive && <ShoppingListLiveRefresh />}
			{checks.notices.length > 0 && (
				<div role="alert" className="container-narrow py-3 text-sm">
					{checks.notices.map((message) => (
						<p key={message}>{message}</p>
					))}
				</div>
			)}
			<div>
				<div className="container-narrow py-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<h1 className="font-serif text-2xl font-normal">
							Shopping
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
						<div className="flex items-center gap-2">
							<ShoppingStaplesPicker
								key={shoppingList.householdId ?? shoppingList.id}
								shoppingIdentities={shoppingIdentities}
								showQuietCue={nextItems.length === 0}
							/>
							{hasMealPlan && <ShoppingPlanPicker weeks={weeksWithPlans} />}
						</div>
					</div>
				</div>
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
							description="Tap an item to check it off, then clear the checked rows when you're done."
							dismissText="Got it"
							className="mb-4"
						/>
					)}

				{/* Desktop only. The FAB replaces this on a phone. */}
				<div className="border-border/30 mb-2 hidden border-b md:block">
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
						<HouseholdClientInput />
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
									placeholder="Add an item…"
									enterKeyHint="go"
									autoCapitalize="none"
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
												? 'Transcribing…'
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
										enterKeyHint="go"
										className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<div className="min-w-0 flex-1">
									<Input
										name="unit"
										value={qaUnit}
										onChange={(e) => setQaUnit(e.target.value)}
										placeholder="Unit"
										enterKeyHint="go"
										autoCapitalize="none"
										autoCorrect="off"
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

				{totalItems >= 15 && (
					<div className="relative mt-2">
						<Icon
							name="magnifying-glass"
							size="sm"
							className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<Input
							type="search"
							inputMode="search"
							enterKeyHint="search"
							placeholder="Search Shopping…"
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
									checks={checks}
									items={listedNextItems}
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
										Nothing in Next shop
									</h3>
									<p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
										{hasMealPlan ? (
											<>
												Open <strong>From Plan</strong> to pick Meals, or add an
												item by hand.
											</>
										) : (
											<>
												<Link
													to="/plan"
													className="text-primary font-medium underline underline-offset-2"
												>
													Plan a Meal
												</Link>{' '}
												or add an item by hand.
											</>
										)}
									</p>
								</div>
							) : null}
							{!search && (
								<ClearCheckedControl
									checked={clearableNext}
									horizon={NEXT_SHOP}
								/>
							)}
						</div>
					</>
				)}

				<section className="border-border/50 mt-8 border-t pt-3">
					<button
						type="button"
						// The heading starts on the content edge, like the list
						// above; the hover fill reaches past it.
						className="hover:bg-muted/50 -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left"
						onClick={() => setLaterExpanded((expanded) => !expanded)}
						aria-expanded={showLaterContents}
						aria-controls="later-shopping-items"
					>
						<h2 className="font-serif text-lg">Later</h2>
						<span className="text-muted-foreground text-sm tabular-nums">
							({laterItems.length})
						</span>
						<Icon
							name="chevron-down"
							size="sm"
							className={cn(
								'text-muted-foreground transition-transform',
								showLaterContents && 'rotate-180',
							)}
						/>
						{checkedLaterItems > 0 && (
							<span className="text-muted-foreground ml-auto text-xs tabular-nums">
								{checkedLaterItems} checked
							</span>
						)}
					</button>
					{showLaterContents && (
						<div id="later-shopping-items" data-shopping-horizon={LATER}>
							{!search && <LaterQuickAdd />}
							{filteredLaterItems.length > 0 ? (
								<ShoppingItems
									checks={checks}
									items={listedLaterItems}
									voiceAddedNames={voiceAddedNames}
								/>
							) : (
								<p className="text-muted-foreground py-6 text-center text-sm">
									Nothing in Later.
								</p>
							)}
							{!search && (
								<ClearCheckedControl checked={clearableLater} horizon={LATER} />
							)}
						</div>
					)}
				</section>
			</div>

			<MobileFabAdd
				open={fabOpen}
				onOpenChange={setFabOpen}
				isProActive={isProActive}
				onVoiceItemsAdded={handleMobileVoiceItems}
			/>
		</div>
	)
}
