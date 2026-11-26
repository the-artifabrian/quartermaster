// The Shopping screen, which routes/shopping.tsx renders.
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useFetcher, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { useHiddenRows } from '#app/components/undo-delete.tsx'
import { ShoppingListLiveRefresh } from '#app/components/shopping-live-refresh.tsx'
import { ShoppingAddBar } from '#app/components/shopping-add-bar.tsx'
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
import { TabTitle } from '#app/components/ui/title-add-button.tsx'
import { useCheckMoves } from '#app/hooks/use-check-moves.ts'
import { useFetcherSettled } from '#app/hooks/use-fetcher-settled.ts'
import { usePendingShoppingItems } from '#app/hooks/use-pending-shopping-items.ts'
import { useShoppingChecks } from '#app/hooks/use-shopping-checks.tsx'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import {
	getHouseholdClientId,
	HouseholdClientInput,
} from '#app/utils/household-client.tsx'
import { cn } from '#app/utils/misc.tsx'
import {
	clearableRows,
	placeShoppingRows,
} from '#app/utils/shopping-check-order.ts'
import { LATER, NEXT_SHOP } from '#app/utils/shopping-horizon.ts'
import { mergeOptimisticShoppingItems } from '#app/utils/shopping-optimistic.ts'
import { useStaleRevalidate } from '#app/utils/use-stale-revalidate.ts'
import { type Route } from '../routes/+types/shopping.ts'

export function ShoppingListRoute({ loaderData }: Route.ComponentProps) {
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
	// On a phone the search field waits behind the magnifier.
	const [searchOpen, setSearchOpen] = useState(false)
	const searchRef = useRef<HTMLInputElement>(null)
	const magnifierRef = useRef<HTMLButtonElement>(null)
	const [laterExpanded, setLaterExpanded] = useState(false)
	const [quickAddOpen, setQuickAddOpen] = useState(false)
	const [addSheetOpen, setAddSheetOpen] = useState(false)
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
	useFetcherSettled(bulkAddFetcher, (answer) => {
		void revalidator.revalidate()
		const result = answer as
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
	})

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
	useFetcherSettled(quickAddFetcher, (data) => {
		if (data?.status === 'success') {
			setQaName('')
			setQaQuantity('')
			setQaUnit('')
			setWarningDismissed(false)
			qaInputRef.current?.focus()
		}
	})

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
	const pendingIds = new Set(checks.pendingIds)

	// A row checked on a phone holds its place for half a second, then folds
	// into Checked (useCheckMoves).
	const moves = useCheckMoves(
		listedItems.map((item) => ({
			id: item.id,
			checked: item.checked,
			resting: checks.savedChecked(item),
			pending: pendingIds.has(item.id),
		})),
	)
	const isMoving = (id: string) => {
		const phase = moves.state.moves.get(id)?.phase
		return phase !== undefined && phase !== 'arriving'
	}

	const searchLower = search.toLowerCase()
	const filterBySearch = (items: typeof allItems) =>
		search
			? items.filter((item) => item.name.toLowerCase().includes(searchLower))
			: items
	// What the lists render: the visible rows plus the collapsed ones.
	const place = (horizon: typeof NEXT_SHOP | typeof LATER, searched = true) =>
		placeShoppingRows(
			(searched ? filterBySearch : (items: typeof allItems) => items)(
				listedItems.filter((item) => item.horizon === horizon),
			),
			moves.state,
			checks.savedChecked,
		)
	const next = place(NEXT_SHOP)
	const later = place(LATER)
	const visible = (rows: typeof next.open) =>
		rows.filter((row) => !hidden.has(row.item.id))
	const openNextShowing = visible(next.open).length > 0
	const doneNextShowing = visible(next.done).length > 0
	const filteredLaterItems = filterBySearch(laterItems)
	const hasSearchResults =
		openNextShowing || doneNextShowing || filteredLaterItems.length > 0
	const showLaterContents =
		laterExpanded || (Boolean(search) && filteredLaterItems.length > 0)

	// Counted over every row, whatever the search shows.
	const clearable = (horizon: typeof NEXT_SHOP | typeof LATER) =>
		clearableRows(visible(place(horizon, false).done), pendingIds)
	const clearableNext = clearable(NEXT_SHOP)
	const clearableLater = clearable(LATER)
	const checkedNextItems = clearableNext.length
	const checkedLaterItems = clearableLater.length
	// The phone's count follows the circles: a row counts as checked the
	// moment it is tapped.
	const toBuy = nextItems.filter((item) => !item.checked).length

	const doneIds = new Set(
		[...next.done, ...later.done].map((row) => row.item.id),
	)
	const rowChecks: typeof checks = {
		...checks,
		toggle(item) {
			moves.tap(item.id, doneIds.has(item.id), !item.checked)
			checks.toggle(item)
		},
	}

	function openSearch() {
		// Focused inside the tap, so iOS raises the keyboard.
		flushSync(() => setSearchOpen(true))
		searchRef.current?.focus()
	}
	function closeSearch() {
		setSearch('')
		setSearchOpen(false)
		magnifierRef.current?.focus()
	}

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

	const pickerTrigger =
		'max-md:bg-muted max-md:hover:bg-muted whitespace-nowrap max-md:border-transparent max-md:px-3'

	return (
		<div className="pb-[calc(var(--bottom-nav-h)+var(--bottom-nav-inset)+5rem)] md:pb-6">
			{isProActive && <ShoppingListLiveRefresh />}
			{checks.notices.length > 0 && (
				<div role="alert" className="container-narrow py-3 text-sm">
					{checks.notices.map((message) => (
						<p key={message}>{message}</p>
					))}
				</div>
			)}
			<div>
				<div className="container-narrow pt-4 pb-2 md:py-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						{/* On a phone the title row is the full width, so From Staples
						    and From Plan sit under it; wider they follow the title. */}
						<div className="flex min-w-0 items-center gap-3 max-md:w-full">
							<TabTitle className="min-w-0 flex-1">
								Shopping
								{nextItems.length > 0 && (
									<>
										<span
											aria-hidden="true"
											className="text-muted-foreground ml-3 inline-block font-sans text-base font-normal whitespace-nowrap tabular-nums md:hidden"
										>
											{toBuy > 0 ? `${toBuy} to buy` : 'All checked'}
										</span>
										<span
											aria-hidden="true"
											className="text-muted-foreground ml-2 hidden font-sans text-lg font-normal tabular-nums md:inline"
										>
											({checkedNextItems}/{nextItems.length})
										</span>
										<span className="sr-only">
											, {checkedNextItems} of {nextItems.length} items for this
											shop checked
										</span>
									</>
								)}
							</TabTitle>
							{totalItems >= 15 && (
								<button
									ref={magnifierRef}
									type="button"
									onClick={searchOpen ? closeSearch : openSearch}
									aria-label="Search Shopping"
									aria-expanded={searchOpen}
									aria-controls="shopping-search"
									// The glyph ends on the content edge; the 44px target
									// reaches into the gutter.
									className="text-primary active:bg-muted -mr-3 ml-auto flex size-11 shrink-0 items-center justify-center rounded-full md:hidden"
								>
									<Icon name="magnifying-glass" className="size-5" />
								</button>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<ShoppingStaplesPicker
								key={shoppingList.householdId ?? shoppingList.id}
								shoppingIdentities={shoppingIdentities}
								showQuietCue={nextItems.length === 0}
								triggerClassName={pickerTrigger}
							/>
							{hasMealPlan && (
								<ShoppingPlanPicker
									weeks={weeksWithPlans}
									triggerClassName={pickerTrigger}
								/>
							)}
						</div>
					</div>
				</div>
			</div>

			<div className="container-narrow py-4 max-md:pt-2">
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

				{/* Desktop only. The docked add bar replaces this on a phone. */}
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
									className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
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
									className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
								>
									Hide
								</button>
							</div>
						)}
					</quickAddFetcher.Form>
				</div>

				{totalItems >= 15 && (
					<div
						id="shopping-search"
						className={cn(
							'mt-2 flex items-center gap-1',
							!searchOpen && 'max-md:hidden',
						)}
					>
						<div className="relative min-w-0 flex-1">
							<Icon
								name="magnifying-glass"
								size="sm"
								className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
							/>
							<Input
								ref={searchRef}
								type="search"
								inputMode="search"
								enterKeyHint="search"
								placeholder="Search Shopping…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="pl-9"
							/>
						</div>
						<button
							type="button"
							onClick={closeSearch}
							className="text-primary -mr-3 flex min-h-11 shrink-0 items-center px-3 text-base font-medium md:hidden"
						>
							Done
						</button>
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
					<div
						className="mt-2"
						data-shopping-horizon={NEXT_SHOP}
						data-testid="next-shopping-items"
					>
						{openNextShowing ? (
							<ShoppingItems
								checks={rowChecks}
								rows={next.open}
								voiceAddedNames={voiceAddedNames}
								moving={isMoving}
								group="to-buy"
							/>
						) : doneNextShowing ? (
							!search && (
								<div className="py-8 text-center md:hidden">
									<h2 className="font-serif text-[1.375rem]">
										Everything is checked
									</h2>
									<p className="text-muted-foreground mx-auto mt-1 max-w-sm text-base">
										Clear the checked rows when you are home, or add what you
										forgot.
									</p>
								</div>
							)
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
						{next.done.length > 0 && (
							// On a phone the checked rows are their own group under a
							// heading; wider they carry on the list, as one.
							<section
								aria-labelledby={
									doneNextShowing ? 'shopping-checked-heading' : undefined
								}
								className="max-md:mt-6"
							>
								{doneNextShowing && (
									<div className="border-border flex min-h-11 items-center gap-2 border-b md:hidden">
										<h2
											id="shopping-checked-heading"
											className="text-[0.84375rem] font-semibold"
										>
											Checked
										</h2>
										<span className="text-muted-foreground text-[0.84375rem] tabular-nums">
											{nextItems.length - toBuy} of {nextItems.length}
										</span>
										{!search && (
											<ClearCheckedControl
												checked={clearableNext}
												horizon={NEXT_SHOP}
												inHeading
											/>
										)}
									</div>
								)}
								<ShoppingItems
									checks={rowChecks}
									rows={next.done}
									voiceAddedNames={voiceAddedNames}
									moving={isMoving}
									group="checked"
									className={cn(
										openNextShowing && 'md:border-border/40 md:border-t',
									)}
								/>
							</section>
						)}
						{!search && (
							<div className="hidden md:block">
								<ClearCheckedControl
									checked={clearableNext}
									horizon={NEXT_SHOP}
								/>
							</div>
						)}
					</div>
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
								// Later keeps its checked rows in its own list.
								<ShoppingItems
									checks={rowChecks}
									rows={[...later.open, ...later.done]}
									voiceAddedNames={voiceAddedNames}
									moving={isMoving}
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

			<ShoppingAddBar
				open={addSheetOpen}
				onOpenChange={setAddSheetOpen}
				isProActive={isProActive}
				onVoiceItemsAdded={handleMobileVoiceItems}
			/>
		</div>
	)
}
