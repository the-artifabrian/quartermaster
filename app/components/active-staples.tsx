import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

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
		<div className="container-content w-full min-w-0 overflow-x-hidden py-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:py-6 md:pb-8">
			<header>
				<h1 className="font-serif text-2xl font-normal">Staples</h1>
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
								maxLength={200}
								className="min-h-11"
								disabled={addFetcher.state !== 'idle'}
							/>
						</div>
						<Button
							type="submit"
							className="min-h-11 shrink-0"
							disabled={!newStaple.trim() || addFetcher.state !== 'idle'}
						>
							{addFetcher.state === 'idle' ? 'Add' : 'Adding…'}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="min-h-11 shrink-0"
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
				) : (
					<div className="mt-4 flex items-center gap-2">
						{staples.length >= 12 && (
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
									value={search}
									onChange={(event) => setSearch(event.currentTarget.value)}
									placeholder="Search"
									className="min-h-11 pl-9"
								/>
							</div>
						)}
						<Button
							ref={addButtonRef}
							type="button"
							variant="outline"
							className="min-h-11 shrink-0"
							aria-label="Add Staple"
							onClick={openAdd}
						>
							<Icon name="plus" size="sm" /> Add
						</Button>
					</div>
				)}
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
						className="mt-4 min-h-11"
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
			) : (
				<div className="bg-muted/40 mt-5 rounded-lg p-6 text-center">
					<h2 className="font-serif text-xl font-normal">No Staples yet</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Add something your household normally has, and it is one tap away
						from every shop.
					</p>
				</div>
			)}
		</div>
	)
}

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
	const removeFetcher = useFetcher<StaplesResponse>()
	const [confirmRemove, setConfirmRemove] = useState(false)
	const isAdding = shopFetcher.state !== 'idle'
	// The loader is revalidated by the time the fetcher is idle, so this only
	// covers the request itself.
	const onShoppingList = staple.onShoppingList || isAdding
	const shopFailed = !isAdding && shopFetcher.data?.status === 'error'

	useEffect(() => {
		if (shopFetcher.state !== 'idle') return
		const message = shopFetcher.data?.message
		if (message) onAnnounce(message)
	}, [onAnnounce, shopFetcher.data, shopFetcher.state])

	return (
		<li className="w-full min-w-0 py-1">
			<div className="flex w-full min-w-0 items-center gap-2">
				<span className="min-w-0 flex-1 truncate pl-1">
					{staple.displayName}
				</span>
				{/* Enabled even when the row is already on the list: a second tap
				    writes nothing and answers "is this one done?" out loud. */}
				<Button
					type="button"
					variant={onShoppingList ? 'ghost' : 'outline'}
					className="min-h-11 min-w-24 shrink-0 justify-center px-3"
					aria-label={
						onShoppingList
							? `${staple.displayName} is in Next shop`
							: `Add ${staple.displayName} to Next shop`
					}
					aria-busy={isAdding || undefined}
					onClick={() =>
						void shopFetcher.submit(
							{ intent: 'add-staple-to-shop', itemId: staple.id },
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
						'Add'
					)}
				</Button>
				<Button
					type="button"
					variant={confirmRemove ? 'destructive' : 'ghost'}
					className="min-h-11 min-w-11 px-3"
					aria-label={
						removeFetcher.state !== 'idle'
							? `Removing ${staple.displayName}`
							: confirmRemove
								? `Confirm remove ${staple.displayName}`
								: `Remove ${staple.displayName}`
					}
					onClick={() => {
						if (!confirmRemove) {
							setConfirmRemove(true)
							return
						}
						void removeFetcher.submit(
							{ intent: 'remove-staple', itemId: staple.id },
							{ method: 'POST' },
						)
					}}
					aria-busy={removeFetcher.state !== 'idle' || undefined}
					disabled={removeFetcher.state !== 'idle'}
				>
					<Icon name="trash" size="sm" />
					{removeFetcher.state !== 'idle' ? (
						<span>Removing…</span>
					) : (
						confirmRemove && <span>Remove?</span>
					)}
				</Button>
			</div>
			{shopFailed && (
				<p className="text-destructive mt-1 pl-1 text-sm" role="alert">
					{shopFetcher.data?.message ??
						`Could not add ${staple.displayName} to Next shop`}
				</p>
			)}
			{removeFetcher.data?.status === 'error' && (
				<p className="text-destructive mt-1 pl-1 text-sm" role="alert">
					{removeFetcher.data.message ??
						`Could not remove ${staple.displayName}`}
				</p>
			)}
		</li>
	)
}
