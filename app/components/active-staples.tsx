import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

type StaplesResponse = {
	status: 'success' | 'error'
	message?: string
	shoppingEffect?: 'added' | 'moved' | 'resurfaced' | 'already-in-next-shop'
	action?: 'add-staple' | 'add-staple-to-shop' | 'remove-staple'
}

type Staple = { id: string; displayName: string }

/**
 * The Staples screen: the household's list of usual items (#289). One tap puts
 * a Staple on Next shop, which is the only thing this list does — a Staple has
 * no Available/Out state to maintain, because nothing downstream asked for
 * one. Generated Shopping omits a Staple match by default and the Plan picker
 * offers it unticked, both of which a tap here corrects in one move.
 */
export function ActiveStaples({ staples }: { staples: Staple[] }) {
	const addFetcher = useFetcher<StaplesResponse>()
	const shopFetcher = useFetcher<StaplesResponse>()
	const [search, setSearch] = useState('')
	const [newStaple, setNewStaple] = useState('')
	const [addOpen, setAddOpen] = useState(false)
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const lastShoppedId = useRef<string | null>(null)
	const shopButtons = useRef(new Map<string, HTMLButtonElement>())
	const submittedShopId = shopFetcher.formData?.get('itemId')
	const pendingShopId =
		shopFetcher.state !== 'idle' && typeof submittedShopId === 'string'
			? submittedShopId
			: null

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

	// A tap re-renders the row it was on; keep the keyboard where it was.
	useEffect(() => {
		const itemId = lastShoppedId.current
		if (!itemId) return
		const frame = requestAnimationFrame(() =>
			shopButtons.current.get(itemId)?.focus(),
		)
		return () => cancelAnimationFrame(frame)
	}, [pendingShopId, staples, shopFetcher.state])

	function addToShop(staple: Staple) {
		if (shopFetcher.state !== 'idle') return
		lastShoppedId.current = staple.id
		void shopFetcher.submit(
			{ intent: 'add-staple-to-shop', itemId: staple.id },
			{ method: 'POST' },
		)
	}

	const pendingStaple = pendingShopId
		? staples.find((staple) => staple.id === pendingShopId)
		: undefined
	const shopFeedback = pendingStaple
		? `Adding ${pendingStaple.displayName} to Next shop…`
		: shopFetcher.data?.message
	const shopFailed =
		shopFetcher.state === 'idle' && shopFetcher.data?.status === 'error'

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
					Things you usually have. Tap one to add it to Next shop.
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

			{/* The row itself is the tap target, so this line always holds its
			    space: a Staple must not slide out from under the finger that
			    just tapped it. */}
			<p
				className={cn(
					'mt-3 min-h-5 text-sm',
					shopFailed ? 'text-destructive' : 'text-muted-foreground',
				)}
				role={shopFailed ? 'alert' : 'status'}
				aria-live="polite"
			>
				{shopFeedback}
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
							onAddToShop={() => addToShop(staple)}
							isAddPending={pendingShopId === staple.id}
							addBusy={shopFetcher.state !== 'idle'}
							setAddButton={(button) => {
								if (button) shopButtons.current.set(staple.id, button)
								else shopButtons.current.delete(staple.id)
							}}
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
	onAddToShop,
	isAddPending,
	addBusy,
	setAddButton,
}: {
	staple: Staple
	onAddToShop: () => void
	isAddPending: boolean
	addBusy: boolean
	setAddButton: (button: HTMLButtonElement | null) => void
}) {
	const removeFetcher = useFetcher<StaplesResponse>()
	const [confirmRemove, setConfirmRemove] = useState(false)

	return (
		<li className="w-full min-w-0 py-1">
			<div className="flex w-full min-w-0 items-center gap-2">
				{/* The name is the button: the list's one job is adding to the
				    next shop, so the whole row carries it. */}
				<button
					ref={setAddButton}
					type="button"
					className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left"
					aria-label={`Add ${staple.displayName} to Next shop`}
					aria-busy={isAddPending || undefined}
					aria-disabled={addBusy || undefined}
					onClick={onAddToShop}
				>
					<Icon
						name="plus"
						size="sm"
						className="text-muted-foreground/60 shrink-0"
					/>
					<span className="min-w-0 flex-1 truncate">{staple.displayName}</span>
				</button>
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
					disabled={addBusy || removeFetcher.state !== 'idle'}
				>
					<Icon name="trash" size="sm" />
					{removeFetcher.state !== 'idle' ? (
						<span>Removing…</span>
					) : (
						confirmRemove && <span>Remove?</span>
					)}
				</Button>
			</div>
			{removeFetcher.data?.status === 'error' && (
				<p className="text-destructive mt-1 text-sm" role="alert">
					{removeFetcher.data.message ??
						`Could not remove ${staple.displayName}`}
				</p>
			)}
		</li>
	)
}
