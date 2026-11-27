import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useFetcher } from 'react-router'
import { getHouseholdClientId } from '#app/utils/household-client.tsx'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { RowCollapse } from './ui/row-collapse.tsx'
import { TabTitle, TitleAddButton, TitleRow } from './ui/title-add-button.tsx'
import {
	useDeleteWithUndo,
	useEnteringRows,
	useHiddenRows,
} from './undo-delete.tsx'
import {
	STAPLE_SWIPE_WIDTH,
	stapleNameClassName,
	stapleNeedClassName,
	stapleRowClassName,
} from './staple-row-styles.ts'
import { StapleSuggestions } from './staple-suggestions.tsx'
import { useSwipeRow } from '#app/hooks/use-swipe-row.ts'

type StaplesResponse = {
	status: 'success' | 'error'
	message?: string
	shoppingEffect?: 'added' | 'moved' | 'resurfaced' | 'already-in-next-shop'
	action?: 'add-staple' | 'add-staple-to-shop'
}

type Staple = {
	id: string
	displayName: string
	/** A matching row is already waiting, unchecked, in Next shop. */
	onShoppingList: boolean
}

/**
 * The Staples screen: the household's list of usual items. Adding one to
 * Next shop is the only thing this list does. A Staple has no Available/Out
 * state to maintain, because nothing downstream asks for one. Generated
 * Shopping omits a Staple match by default and the Plan picker offers it
 * unticked, both of which an add here corrects in one tap.
 *
 * Each row carries its own state and its own errors. Standing in the kitchen
 * you are usually scrolled somewhere down a long list, so a banner at the top
 * of the page is a message you will never see; "On list" on the row itself is
 * the answer to "did that work?" and to "have I already done this one?".
 */
/**
 * Whether the search row is pinned under the status bar. Its `top` is
 * `auto` where it does not pin (wider screens).
 */
function isPinned(tools: HTMLElement) {
	const pinTop = parseFloat(getComputedStyle(tools).top)
	return (
		Number.isFinite(pinTop) &&
		window.scrollY > 0 &&
		tools.getBoundingClientRect().top <= pinTop + 0.5
	)
}

/** Search shows from this many Staples. */
const SEARCH_FROM = 12

export function ActiveStaples({ staples }: { staples: Staple[] }) {
	const addFetcher = useFetcher<StaplesResponse>()
	const [search, setSearch] = useState('')
	const [newStaple, setNewStaple] = useState('')
	const [addOpen, setAddOpen] = useState(false)
	const [announcement, setAnnouncement] = useState('')
	// Counts the add form's closes, so focus goes back to a + once each one
	// has rendered.
	const [addClosed, setAddClosed] = useState(0)
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const pinnedAddRef = useRef<HTMLButtonElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)
	const pageRef = useRef<HTMLDivElement>(null)
	const toolsRef = useRef<HTMLDivElement>(null)
	// A household with no Staples gets suggestions; they stay for the visit so
	// several can be added in a row, and are gone on a later visit.
	const [suggesting] = useState(staples.length === 0)
	// Once Search has shown it stays for the visit, so a delete that takes
	// the list under the threshold neither moves the list under the finger
	// nor drops a search that is still filtering it.
	const [searchKept, setSearchKept] = useState(staples.length >= SEARCH_FROM)
	if (staples.length >= SEARCH_FROM && !searchKept) setSearchKept(true)
	const showSearch = searchKept && staples.length > 0
	const toolsShown = showSearch && !addOpen
	const heldNames = staples.map((staple) => staple.displayName)

	const filteredStaples = useMemo(() => {
		const query = search.trim().toLocaleLowerCase()
		const matching = query
			? staples.filter((staple) =>
					staple.displayName.toLocaleLowerCase().includes(query),
				)
			: staples
		return [...matching].sort((a, b) =>
			a.displayName.localeCompare(b.displayName),
		)
	}, [search, staples])

	useEffect(() => {
		if (
			addFetcher.state === 'idle' &&
			addFetcher.data?.status === 'success' &&
			addFetcher.data.action === 'add-staple'
		) {
			setNewStaple('')
			setSearch('')
			setAddOpen(false)
			setAddClosed((count) => count + 1)
		}
	}, [addFetcher.data, addFetcher.state])

	// On a phone the search row pins under the status bar. While it is pinned
	// the title's + has scrolled away, so the row shows its own, and only one
	// of the two is reachable at a time. Read from the row's place on each
	// scrolled frame, not from an IntersectionObserver, which reports only a
	// crossing and misses a jump or a reload far down the list. Set as an
	// attribute, so a scroll never renders the rows again.
	useEffect(() => {
		const page = pageRef.current
		const tools = toolsRef.current
		if (!page) return
		if (!tools) {
			page.removeAttribute('data-pinned')
			return
		}
		let frame = 0
		const read = () => {
			frame = 0
			const pinned = isPinned(tools)
			if (page.hasAttribute('data-pinned') === pinned) return
			// Focus on the + that goes away moves to the one that comes.
			const [leaving, coming] = pinned
				? [addButtonRef.current, pinnedAddRef.current]
				: [pinnedAddRef.current, addButtonRef.current]
			const hadFocus = leaving != null && document.activeElement === leaving
			page.toggleAttribute('data-pinned', pinned)
			if (hadFocus) coming?.focus({ preventScroll: true })
		}
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(read)
		}
		read()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule)
		return () => {
			cancelAnimationFrame(frame)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [toolsShown])

	// After the effect above, so the pinned state is current.
	useEffect(() => {
		if (addClosed > 0) focusShownAdd()
		// focusShownAdd reads refs only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [addClosed])

	function openAdd(from: 'title' | 'pinned') {
		// Already open: the + takes you back to the field.
		if (addOpen) {
			document.getElementById('new-staple')?.focus()
			return
		}
		addFetcher.reset()
		// Rendered and focused inside the tap, so iOS raises the keyboard.
		flushSync(() => {
			setSearch('')
			setAddOpen(true)
		})
		document.getElementById('new-staple')?.focus({ preventScroll: true })
		// From the pinned row the form is far up the page, under the title.
		if (from === 'pinned') window.scrollTo({ top: 0, behavior: 'instant' })
	}

	function cancelAdd() {
		addFetcher.reset()
		setNewStaple('')
		setAddOpen(false)
		setAddClosed((count) => count + 1)
	}

	/**
	 * After the add form closes, focus goes to the + on the screen. Scrolled
	 * far down with the form open, the search row comes back already pinned
	 * and the title's + hidden, so the pinned state is read here as well.
	 */
	function focusShownAdd() {
		const tools = toolsRef.current
		const pinned = tools != null && isPinned(tools)
		pageRef.current?.toggleAttribute('data-pinned', pinned)
		if (pinned) pinnedAddRef.current?.focus({ preventScroll: true })
		else addButtonRef.current?.focus()
	}

	function clearSearch() {
		setSearch('')
		searchRef.current?.focus()
	}

	return (
		<div
			ref={pageRef}
			className="group/staples container-content w-full min-w-0 py-4 pb-[calc(var(--bottom-nav-h)+2rem+var(--bottom-nav-inset))] md:py-6 md:pb-8"
		>
			<header>
				<TitleRow>
					<TabTitle>Staples</TabTitle>
					<TitleAddButton
						ref={addButtonRef}
						data-title-add=""
						aria-label="Add Staple"
						aria-expanded={addOpen}
						aria-controls={addOpen ? 'add-staple-form' : undefined}
						onClick={() => openAdd('title')}
						// Scrolled away while the search row is pinned, where the
						// row's own + takes its place.
						className="group-data-[pinned]/staples:invisible"
					/>
				</TitleRow>
				<p className="text-muted-foreground mt-1 max-w-xl text-[0.9375rem] leading-normal">
					Things you usually have. Add one to put it on Next shop.
				</p>

				{addOpen ? (
					<addFetcher.Form
						id="add-staple-form"
						method="post"
						className="mt-4 flex max-w-2xl flex-wrap items-center gap-2"
						onKeyDown={(event) => {
							if (event.key === 'Escape' && addFetcher.state === 'idle') {
								event.preventDefault()
								cancelAdd()
							}
						}}
					>
						<input type="hidden" name="intent" value="add-staple" />
						<div className="min-w-0 flex-1">
							<label htmlFor="new-staple" className="sr-only">
								Add a Staple
							</label>
							<Input
								id="new-staple"
								name="displayName"
								value={newStaple}
								onChange={(event) => setNewStaple(event.currentTarget.value)}
								placeholder="Staple name"
								enterKeyHint="done"
								autoCapitalize="none"
								maxLength={200}
								disabled={addFetcher.state !== 'idle'}
							/>
						</div>
						<Button
							type="submit"
							className="shrink-0"
							disabled={!newStaple.trim() || addFetcher.state !== 'idle'}
						>
							{addFetcher.state === 'idle' ? 'Add' : 'Adding…'}
						</Button>
						<Button
							type="button"
							variant="secondary"
							className="shrink-0"
							disabled={addFetcher.state !== 'idle'}
							onClick={cancelAdd}
						>
							Cancel
						</Button>
						{addFetcher.data?.status === 'error' && (
							<p
								className="text-foreground-destructive basis-full text-sm"
								role="alert"
							>
								{addFetcher.data.message ?? 'Could not add Staple'}
							</p>
						)}
					</addFetcher.Form>
				) : null}
			</header>

			{toolsShown ? (
				// A child of the whole page, not of the header, so on a phone it
				// stays pinned under the status bar for the length of the list,
				// opaque and edge to edge (tailwind.css keeps what takes focus
				// below it, and the top toasts under it).
				<div
					ref={toolsRef}
					data-staples-tools=""
					className="max-md:border-border max-md:bg-background mt-4 flex items-center gap-2 max-md:sticky max-md:top-(--safe-top) max-md:z-30 max-md:-mx-4 max-md:border-b max-md:px-4 max-md:py-3.5 sm:max-md:-mx-8 sm:max-md:px-8"
				>
					<div className="relative min-w-0 flex-1 sm:max-w-md">
						<label htmlFor="search-staples" className="sr-only">
							Search Staples
						</label>
						<Icon
							name="magnifying-glass"
							size="sm"
							className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<Input
							ref={searchRef}
							id="search-staples"
							type="search"
							inputMode="search"
							enterKeyHint="search"
							value={search}
							onChange={(event) => setSearch(event.currentTarget.value)}
							placeholder="Search"
							// The clear button below replaces the browser's own.
							className={cn(
								'pl-9 [&::-webkit-search-cancel-button]:hidden',
								search && 'pr-11',
							)}
						/>
						{search ? (
							<button
								type="button"
								aria-label="Clear the search field"
								// Focus stays in the field, so the keyboard stays up.
								onMouseDown={(event) => event.preventDefault()}
								onClick={clearSearch}
								className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-11 items-center justify-center transition-opacity active:opacity-60"
							>
								<Icon name="cross-1" size="sm" />
							</button>
						) : null}
					</div>
					<TitleAddButton
						ref={pinnedAddRef}
						aria-label="Add Staple"
						aria-expanded={addOpen}
						onClick={() => openAdd('pinned')}
						// Only while the row is pinned, far from the title's +.
						className="ml-auto hidden group-data-[pinned]/staples:inline-flex"
					/>
				</div>
			) : null}

			{/* The row says what happened; this repeats it for a screen reader,
			    whose focus stays on a button whose label just changed. */}
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			{search.trim() && filteredStaples.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
						<Icon
							name="magnifying-glass"
							className="text-muted-foreground/40 size-8"
						/>
					</div>
					<h2 className="mt-4 font-serif text-xl">No Staples found</h2>
					<p className="text-muted-foreground mt-2 max-w-sm">
						Nothing matches &ldquo;{search.trim()}&rdquo;.
					</p>
					<Button
						type="button"
						variant="outline"
						className="mt-6"
						onClick={() => setSearch('')}
					>
						Clear search
					</Button>
				</div>
			) : filteredStaples.length > 0 ? (
				<ul
					aria-label="Staples"
					className={cn(
						'divide-border/40 divide-y md:mt-5 md:border-t',
						!toolsShown && 'max-md:mt-3',
					)}
				>
					{filteredStaples.map((staple) => (
						<StapleRow
							key={staple.id}
							staple={staple}
							onAnnounce={setAnnouncement}
						/>
					))}
				</ul>
			) : suggesting ? (
				<StapleSuggestions
					held={heldNames}
					heading="No Staples yet"
					lead="Tap the ones your Household usually has, or add your own. Tap Need on one to put it on Next shop."
				/>
			) : (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
						<Icon
							name="file-text"
							className="text-muted-foreground/40 size-8"
						/>
					</div>
					<h2 className="mt-4 font-serif text-xl">No Staples yet</h2>
					<p className="text-muted-foreground mt-2 max-w-sm">
						Add what your Household usually has. Tap Need on one to put it on
						Next shop.
					</p>
				</div>
			)}
			{suggesting && staples.length > 0 && !search.trim() ? (
				<StapleSuggestions
					held={heldNames}
					heading="Others you might keep"
					lead="Tap to add."
				/>
			) : null}
		</div>
	)
}

/**
 * A mouse: the row shows its own trash button and does not swipe. Read when
 * a finger lands, not on render, so the server and first render agree.
 */
const FINE_POINTER = '(pointer: fine)'

function StapleRow({
	staple,
	onAnnounce,
}: {
	staple: Staple
	onAnnounce: (message: string) => void
}) {
	// One fetcher per row, so adding three things in a row does not queue
	// behind a list-wide lock, and a failure belongs to the row that failed.
	const shopFetcher = useFetcher<StaplesResponse>()
	const deleteWithUndo = useDeleteWithUndo()
	const hidden = useHiddenRows()
	const entering = useEnteringRows()
	const isAdding = shopFetcher.state !== 'idle'
	// The loader is revalidated by the time the fetcher is idle, so this only
	// covers the request itself.
	const onShoppingList = staple.onShoppingList || isAdding
	const shopFailed = !isAdding && shopFetcher.data?.status === 'error'
	// Focus on Delete opened the row, so focus leaving it shuts it. A swipe
	// since then hands the row back to the finger.
	const openedByFocus = useRef(false)
	// Swiping a row left uncovers a red Delete, as on Shopping.
	const swipe = useSwipeRow<HTMLDivElement>({
		enabled: true,
		width: STAPLE_SWIPE_WIDTH,
		onSwiped: () => {
			openedByFocus.current = false
		},
	})

	useEffect(() => {
		if (shopFetcher.state !== 'idle') return
		const message = shopFetcher.data?.message
		if (message) onAnnounce(message)
	}, [onAnnounce, shopFetcher.data, shopFetcher.state])

	function deleteStaple() {
		// At once, with Undo: the Staple is only unmarked, never lost.
		deleteWithUndo({
			key: `staple:${staple.id}`,
			hides: [staple.id],
			message: `Deleted ${staple.displayName}`,
			what: staple.displayName,
			request: { intent: 'remove-staple', stapleId: staple.id },
		})
	}

	return (
		// A deleted Staple closes its gap, and Undo opens it again.
		<RowCollapse
			as="li"
			hidden={hidden.has(staple.id)}
			entering={entering.has(staple.id)}
			className="w-full min-w-0"
		>
			{/* Reaches 14px into the right gutter, as a Shopping row does, so
			    the Need button can end on the content edge with room for its
			    focus ring inside the clip. */}
			<div className="relative -mr-3.5 overflow-hidden">
				<div
					ref={swipe.ref}
					onPointerDown={(event) => {
						if (window.matchMedia?.(FINE_POINTER).matches) return
						swipe.handlers.onPointerDown(event)
					}}
					// A tap on an open row shuts it instead of adding the Staple.
					onClickCapture={swipe.handlers.onClickCapture}
					className={cn(
						stapleRowClassName,
						'bg-background relative z-1 touch-pan-y touch-pinch-zoom pr-3.5',
					)}
				>
					{/* The row itself is not a tap target, only the button is: a
					    tap that lands while scrolling would put the Staple on Next
					    shop, and this screen has no Undo for that. */}
					<span className={cn(stapleNameClassName, 'md:text-base')}>
						{staple.displayName}
					</span>
					{/* Enabled even when the row is already on the list: a second tap
					    writes nothing and answers "is this one done?" out loud. Its
					    name starts with what it shows, then says which Staple. One
					    width in both states, so a tap never wraps the name again. */}
					<button
						type="button"
						data-slot="button"
						className={stapleNeedClassName(onShoppingList)}
						aria-label={`${onShoppingList ? 'On list' : 'Need'}, ${staple.displayName}`}
						aria-busy={isAdding || undefined}
						onClick={() =>
							void shopFetcher.submit(
								{
									intent: 'add-staple-to-shop',
									itemId: staple.id,
									originClientId: getHouseholdClientId(),
								},
								{ method: 'POST' },
							)
						}
					>
						{onShoppingList ? (
							<>
								<Icon name="check" size="sm" />
								<span>On list</span>
							</>
						) : (
							'Need'
						)}
					</button>
					<Button
						type="button"
						variant="ghost"
						className="text-foreground-destructive hover:text-foreground-destructive hidden min-h-11 min-w-11 px-3 pointer-fine:inline-flex"
						aria-label={`Delete ${staple.displayName}`}
						onClick={deleteStaple}
					>
						<Icon name="trash" size="sm" />
					</Button>
				</div>
				{/* Under the row (which sits above it), uncovered by a swipe to
				    the left. With a keyboard or VoiceOver it is the next stop
				    after the row's Add, and the row slides open while it has
				    focus. A mouse gets the trash button in the row instead. */}
				<button
					type="button"
					aria-label={`Delete ${staple.displayName}`}
					onFocus={() => {
						if (swipe.open) return
						openedByFocus.current = true
						swipe.show()
					}}
					onBlur={() => {
						if (!openedByFocus.current) return
						openedByFocus.current = false
						swipe.close()
					}}
					onClick={() => {
						deleteStaple()
						swipe.closeAfterDelete()
					}}
					style={{ width: STAPLE_SWIPE_WIDTH }}
					className="bg-destructive text-destructive-foreground active:bg-destructive/90 absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 text-xs font-medium pointer-fine:hidden"
				>
					<Icon name="trash" size="sm" />
					Delete
				</button>
			</div>
			{shopFailed && (
				<p
					className="text-foreground-destructive -mt-1 pb-2 text-sm"
					role="alert"
				>
					{shopFetcher.data?.message ??
						`Could not add ${staple.displayName} to Next shop`}
				</p>
			)}
		</RowCollapse>
	)
}
