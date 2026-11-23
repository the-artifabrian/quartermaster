import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { getHouseholdClientId } from '#app/utils/household-client.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { RowCollapse } from './ui/row-collapse.tsx'
import { TitleAddButton, TitleRow } from './ui/title-add-button.tsx'
import {
	useDeleteWithUndo,
	useEnteringRows,
	useHiddenRows,
} from './undo-delete.tsx'
import { StapleSuggestions } from './staple-suggestions.tsx'
import { useSwipeRow } from '#app/hooks/use-swipe-row.ts'

type StaplesResponse = {
	status: 'success' | 'error'
	message?: string
	shoppingEffect?: 'added' | 'moved' | 'resurfaced' | 'already-in-next-shop'
	action?: 'add-staple' | 'add-staple-to-shop' | 'remove-staple'
}

type Staple = {
	id: string
	displayName: string
	/** A matching row is already waiting, unchecked, in Next shop. */
	onShoppingList: boolean
}

/**
 * The Staples screen: the household's list of usual items (#289). Adding one to
 * Next shop is the only thing this list does — a Staple has no Available/Out
 * state to maintain, because nothing downstream asked for one. Generated
 * Shopping omits a Staple match by default and the Plan picker offers it
 * unticked, both of which an add here corrects in one tap.
 *
 * Each row carries its own state and its own errors. Standing in the kitchen
 * you are usually scrolled somewhere down a long list, so a banner at the top
 * of the page is a message you will never see; "On list" on the row itself is
 * the answer to "did that work?" and to "have I already done this one?".
 */
export function ActiveStaples({ staples }: { staples: Staple[] }) {
	const addFetcher = useFetcher<StaplesResponse>()
	const [search, setSearch] = useState('')
	const [newStaple, setNewStaple] = useState('')
	const [addOpen, setAddOpen] = useState(false)
	const [announcement, setAnnouncement] = useState('')
	const addButtonRef = useRef<HTMLButtonElement>(null)
	// A household with no Staples gets suggestions; they stay for the visit so
	// several can be added in a row, and are gone on a later visit (#351).
	const [suggesting] = useState(staples.length === 0)
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
			requestAnimationFrame(() => addButtonRef.current?.focus())
		}
	}, [addFetcher.data, addFetcher.state])

	function openAdd() {
		// Already open: the + takes you back to the field.
		if (addOpen) {
			document.getElementById('new-staple')?.focus()
			return
		}
		addFetcher.reset()
		setSearch('')
		setAddOpen(true)
	}

	function cancelAdd() {
		addFetcher.reset()
		setNewStaple('')
		setAddOpen(false)
		requestAnimationFrame(() => addButtonRef.current?.focus())
	}

	return (
		<div className="container-content w-full min-w-0 overflow-x-hidden py-4 pb-[calc(var(--bottom-nav-h)+2rem+var(--bottom-nav-inset))] md:py-6 md:pb-8">
			<header>
				<TitleRow>
					<h1 className="font-serif text-2xl font-normal">Staples</h1>
					<TitleAddButton
						ref={addButtonRef}
						aria-label="Add Staple"
						aria-expanded={addOpen}
						aria-controls={addOpen ? 'add-staple-form' : undefined}
						onClick={openAdd}
					/>
				</TitleRow>
				<p className="text-muted-foreground mt-1 max-w-xl text-sm">
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
								autoFocus
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
							variant="ghost"
							className="shrink-0"
							disabled={addFetcher.state !== 'idle'}
							onClick={cancelAdd}
						>
							Cancel
						</Button>
						{addFetcher.data?.status === 'error' && (
							<p className="text-destructive basis-full text-sm" role="alert">
								{addFetcher.data.message ?? 'Could not add Staple'}
							</p>
						)}
					</addFetcher.Form>
				) : staples.length >= 12 ? (
					<div className="mt-4 flex items-center gap-2">
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
								id="search-staples"
								type="search"
								inputMode="search"
								enterKeyHint="search"
								value={search}
								onChange={(event) => setSearch(event.currentTarget.value)}
								placeholder="Search"
								className="pl-9"
							/>
						</div>
					</div>
				) : null}
			</header>

			{/* The row says what happened; this repeats it for a screen reader,
			    whose focus stays on a button whose label just changed. */}
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			{search.trim() && filteredStaples.length === 0 ? (
				<div className="bg-muted/40 mt-5 rounded-lg p-6 text-center">
					<h2 className="font-serif text-xl font-normal">No Staples found</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Nothing matches &ldquo;{search.trim()}&rdquo;.
					</p>
					<Button
						type="button"
						variant="outline"
						className="mt-4"
						onClick={() => setSearch('')}
					>
						Clear search
					</Button>
				</div>
			) : filteredStaples.length > 0 ? (
				<ul
					aria-label="Staples"
					className="divide-border/40 mt-5 divide-y border-t"
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
					lead="Tap the ones your household usually has, or add your own. Each is one tap away from every shop."
				/>
			) : (
				<div className="bg-muted/40 mt-5 rounded-lg p-6 text-center">
					<h2 className="font-serif text-xl font-normal">No Staples yet</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Add something your household normally has, and it is one tap away
						from every shop.
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

/** The revealed Delete behind a swiped row is this wide (px), as on Shopping. */
const SWIPE_ACTION_WIDTH = 76
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
		width: SWIPE_ACTION_WIDTH,
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
			<div className="relative overflow-hidden">
				<div
					ref={swipe.ref}
					onPointerDown={(event) => {
						if (window.matchMedia?.(FINE_POINTER).matches) return
						swipe.handlers.onPointerDown(event)
					}}
					// A tap on an open row shuts it instead of adding the Staple.
					onClickCapture={swipe.handlers.onClickCapture}
					className="bg-background relative z-1 flex w-full min-w-0 touch-pan-y touch-pinch-zoom items-center gap-2 py-1"
				>
					<span className="min-w-0 flex-1 truncate">{staple.displayName}</span>
					{/* Enabled even when the row is already on the list: a second tap
					    writes nothing and answers "is this one done?" out loud. Its
					    name starts with what it shows, then says which Staple. */}
					<Button
						type="button"
						variant={onShoppingList ? 'ghost' : 'outline'}
						className="min-w-24 shrink-0 justify-center px-3"
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
								<span className="text-muted-foreground">On list</span>
							</>
						) : (
							'Need'
						)}
					</Button>
					<Button
						type="button"
						variant="ghost"
						className="text-destructive hover:text-destructive hidden min-h-11 min-w-11 px-3 pointer-fine:inline-flex"
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
					style={{ width: SWIPE_ACTION_WIDTH }}
					className="bg-destructive text-destructive-foreground active:bg-destructive/90 absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 text-xs font-medium pointer-fine:hidden"
				>
					<Icon name="trash" size="sm" />
					Delete
				</button>
			</div>
			{shopFailed && (
				<p className="text-destructive mt-1 text-sm" role="alert">
					{shopFetcher.data?.message ??
						`Could not add ${staple.displayName} to Next shop`}
				</p>
			)}
		</RowCollapse>
	)
}
