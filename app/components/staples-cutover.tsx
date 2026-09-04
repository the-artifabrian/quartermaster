import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import {
	householdIngredientDisplayName,
	householdIngredientKey,
	type StaplesCutoverOption,
} from '#app/utils/household-ingredient.ts'
import { Button } from './ui/button.tsx'
import { Checkbox } from './ui/checkbox.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

type CutoverResponse = {
	status: 'success' | 'error'
	message?: string
	isOut?: boolean
	shoppingEffect?: 'added' | 'moved' | 'resurfaced' | 'already-in-next-shop'
	action?:
		| 'add-staple'
		| 'toggle-staple-out'
		| 'remove-staple'
		| 'restore-legacy-pantry'
}

export function StaplesCutover({
	options: initialOptions,
	archivedInventoryCount,
	onCancel,
}: {
	options: StaplesCutoverOption[]
	archivedInventoryCount: number
	onCancel?: () => void
}) {
	const fetcher = useFetcher<CutoverResponse>()
	const [options, setOptions] = useState(initialOptions)
	const [selected, setSelected] = useState(
		() =>
			new Set(
				initialOptions
					.filter((option) => option.selected)
					.map((option) => option.canonicalKey),
			),
	)
	const [customName, setCustomName] = useState('')
	const [reviewing, setReviewing] = useState(false)
	const isSubmitting = fetcher.state !== 'idle'
	const selectedOptions = useMemo(
		() => options.filter((option) => selected.has(option.canonicalKey)),
		[options, selected],
	)

	function toggle(canonicalKey: string) {
		setSelected((current) => {
			const next = new Set(current)
			if (next.has(canonicalKey)) next.delete(canonicalKey)
			else next.add(canonicalKey)
			return next
		})
	}

	function addCustom(event: React.FormEvent) {
		event.preventDefault()
		const displayName = householdIngredientDisplayName(customName)
		if (!displayName) return
		const canonicalKey = householdIngredientKey(displayName)
		setOptions((current) =>
			current.some((option) => option.canonicalKey === canonicalKey)
				? current
				: [
						...current,
						{
							displayName,
							canonicalKey,
							selected: true,
							source: 'custom',
						},
					],
		)
		setSelected((current) => new Set(current).add(canonicalKey))
		setCustomName('')
	}

	function confirm() {
		const formData = new FormData()
		formData.set('intent', 'confirm-staples-cutover')
		formData.set(
			'items',
			JSON.stringify(
				selectedOptions.map((option) => ({
					displayName: option.displayName,
				})),
			),
		)
		void fetcher.submit(formData, { method: 'POST' })
	}

	if (reviewing) {
		return (
			<div className="container-content py-6 pb-24 md:py-10 md:pb-10">
				<div className="mx-auto max-w-2xl">
					<p className="text-primary text-xs font-medium tracking-wider uppercase">
						Final review
					</p>
					<h1 className="mt-2 font-serif text-3xl font-normal">
						Switch to Staples?
					</h1>
					<p className="text-muted-foreground mt-3">
						After confirmation, this reviewed selection becomes your household’s
						canonical Staple list. The old Pantry stays archived for recovery
						but stops affecting Recipes and Shopping.
					</p>

					<div className="bg-muted/40 mt-6 rounded-lg p-4 sm:p-5">
						<h2 className="font-medium">
							{selectedOptions.length} Staple
							{selectedOptions.length === 1 ? '' : 's'} selected
						</h2>
						{selectedOptions.length > 0 ? (
							<ul className="mt-3 grid gap-2 sm:grid-cols-2">
								{selectedOptions.map((option) => (
									<li
										key={option.canonicalKey}
										className="flex items-center gap-2"
									>
										<Icon name="check" size="sm" className="text-primary" />
										<span>{option.displayName}</span>
									</li>
								))}
							</ul>
						) : (
							<p className="text-muted-foreground mt-2 text-sm">
								No Staples will be saved. This is a valid confirmed selection,
								not an unfinished setup.
							</p>
						)}
					</div>

					{fetcher.data?.status === 'error' && (
						<p className="text-destructive mt-4 text-sm" role="alert">
							{fetcher.data.message ?? 'Could not switch to Staples'}
						</p>
					)}

					<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
						<Button
							type="button"
							variant="outline"
							onClick={() => setReviewing(false)}
							disabled={isSubmitting}
						>
							Back to selection
						</Button>
						<Button type="button" onClick={confirm} disabled={isSubmitting}>
							{isSubmitting ? 'Switching…' : 'Confirm and switch'}
						</Button>
					</div>
				</div>
			</div>
		)
	}

	const groups: Array<{
		title: string
		description: string
		options: StaplesCutoverOption[]
	}> = [
		{
			title: 'From your Pantry',
			description: `${archivedInventoryCount} existing item${archivedInventoryCount === 1 ? '' : 's'}, selected for review.`,
			options: options.filter((option) => option.source === 'pantry'),
		},
		{
			title: 'Previously confirmed',
			description: 'Saved from an earlier cutover and selected again.',
			options: options.filter((option) => option.source === 'previous'),
		},
		{
			title: 'Common suggestions',
			description: 'Convenient defaults only—change every selection you want.',
			options: options.filter(
				(option) =>
					option.source === 'suggestion' || option.source === 'custom',
			),
		},
	]

	return (
		<div className="container-content py-6 pb-24 md:py-10 md:pb-10">
			<div className="mx-auto max-w-3xl">
				<div className="text-center">
					<Icon name="home" className="text-muted-foreground mx-auto size-11" />
					<h1 className="mt-4 font-serif text-3xl font-normal">
						Review your Staples
					</h1>
					<p className="text-muted-foreground mx-auto mt-3 max-w-2xl">
						Choose ingredients your household normally has. Nothing changes
						until you review the result and confirm the switch.
					</p>
				</div>

				<div className="mt-8 space-y-5">
					{groups.map(
						(group) =>
							group.options.length > 0 && (
								<section
									key={group.title}
									className="bg-muted/40 rounded-lg p-4 sm:p-5"
								>
									<div className="flex items-start justify-between gap-4">
										<div>
											<h2 className="font-serif text-lg font-normal">
												{group.title}
											</h2>
											<p className="text-muted-foreground mt-1 text-sm">
												{group.description}
											</p>
										</div>
									</div>
									<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
										{group.options.map((option) => (
											<label
												key={option.canonicalKey}
												className="bg-background flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 select-none"
											>
												<Checkbox
													checked={selected.has(option.canonicalKey)}
													onCheckedChange={() => toggle(option.canonicalKey)}
												/>
												<span className="text-sm">{option.displayName}</span>
											</label>
										))}
									</div>
								</section>
							),
					)}
				</div>

				<form onSubmit={addCustom} className="mt-5 flex gap-2">
					<label className="sr-only" htmlFor="custom-staple">
						Add another Staple
					</label>
					<Input
						id="custom-staple"
						value={customName}
						onChange={(event) => setCustomName(event.currentTarget.value)}
						placeholder="Add another Staple"
						maxLength={200}
					/>
					<Button type="submit" variant="outline" disabled={!customName.trim()}>
						Add
					</Button>
				</form>

				<div className="mt-6 flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="font-medium">{selectedOptions.length} selected</p>
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground mt-1 text-sm underline underline-offset-2"
							onClick={() => setSelected(new Set())}
						>
							Clear selection
						</button>
					</div>
					<div className="flex flex-col-reverse gap-3 sm:flex-row">
						{onCancel && (
							<Button type="button" variant="ghost" onClick={onCancel}>
								Cancel
							</Button>
						)}
						<Button type="button" onClick={() => setReviewing(true)}>
							Review selection
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}

export function ActiveStaples({
	staples,
}: {
	staples: Array<{
		id: string
		displayName: string
		isOut: boolean
	}>
}) {
	const recoveryFetcher = useFetcher<CutoverResponse>()
	const addFetcher = useFetcher<CutoverResponse>()
	const toggleFetcher = useFetcher<CutoverResponse>()
	const [confirmRecovery, setConfirmRecovery] = useState(false)
	const [search, setSearch] = useState('')
	const [newStaple, setNewStaple] = useState('')
	const [addOpen, setAddOpen] = useState(false)
	const lastToggledId = useRef<string | null>(null)
	const toggleButtons = useRef(new Map<string, HTMLButtonElement>())
	const submittedToggleId = toggleFetcher.formData?.get('itemId')
	const pendingToggleId =
		toggleFetcher.state !== 'idle' && typeof submittedToggleId === 'string'
			? submittedToggleId
			: null
	const displayedStaples = useMemo(
		() =>
			staples.map((staple) =>
				staple.id === pendingToggleId
					? { ...staple, isOut: !staple.isOut }
					: staple,
			),
		[pendingToggleId, staples],
	)
	const filteredStaples = useMemo(() => {
		const query = search.trim().toLocaleLowerCase()
		return query
			? displayedStaples.filter((staple) =>
					staple.displayName.toLocaleLowerCase().includes(query),
				)
			: displayedStaples
	}, [displayedStaples, search])
	const outStaples = useMemo(
		() =>
			filteredStaples
				.filter((staple) => staple.isOut)
				.sort((a, b) => a.displayName.localeCompare(b.displayName)),
		[filteredStaples],
	)
	const availableStaples = useMemo(
		() =>
			filteredStaples
				.filter((staple) => !staple.isOut)
				.sort((a, b) => a.displayName.localeCompare(b.displayName)),
		[filteredStaples],
	)

	useEffect(() => {
		if (
			addFetcher.state === 'idle' &&
			addFetcher.data?.status === 'success' &&
			addFetcher.data.action === 'add-staple'
		) {
			setNewStaple('')
			setAddOpen(false)
		}
	}, [addFetcher.data, addFetcher.state])

	useEffect(() => {
		const itemId = lastToggledId.current
		if (!itemId) return
		const frame = requestAnimationFrame(() =>
			toggleButtons.current.get(itemId)?.focus(),
		)
		return () => cancelAnimationFrame(frame)
	}, [pendingToggleId, staples, toggleFetcher.state])

	function toggleStaple(staple: {
		id: string
		displayName: string
		isOut: boolean
	}) {
		if (toggleFetcher.state !== 'idle') return
		lastToggledId.current = staple.id
		void toggleFetcher.submit(
			{ intent: 'toggle-staple-out', itemId: staple.id },
			{ method: 'POST' },
		)
	}

	const pendingStaple = pendingToggleId
		? staples.find((staple) => staple.id === pendingToggleId)
		: undefined
	const toggleFeedback = pendingStaple
		? `Marking ${pendingStaple.displayName} ${pendingStaple.isOut ? 'available' : 'Out'}…`
		: toggleFetcher.data?.message
	const toggleFailed =
		toggleFetcher.state === 'idle' && toggleFetcher.data?.status === 'error'

	return (
		<div className="container-content w-full min-w-0 overflow-x-hidden py-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:py-6 md:pb-8">
			<header>
				<div className="flex items-start justify-between gap-4">
					<h1 className="font-serif text-2xl font-normal">Staples</h1>
					<Button
						type="button"
						variant="outline"
						className="min-h-11 shrink-0"
						aria-label="Add Staple"
						aria-expanded={addOpen}
						aria-controls="add-staple-form"
						onClick={() => setAddOpen((open) => !open)}
					>
						<Icon name="plus" size="sm" /> Add
					</Button>
				</div>
				<p className="text-muted-foreground mt-1 max-w-xl text-sm">
					Things you usually have. Mark one Out to add it to Next shop.
				</p>
			</header>

			{addOpen && (
				<addFetcher.Form
					id="add-staple-form"
					method="post"
					className="bg-muted/40 mt-4 flex flex-wrap items-end gap-2 rounded-lg p-3"
				>
					<input type="hidden" name="intent" value="add-staple" />
					<div className="min-w-0 flex-1">
						<label htmlFor="new-staple" className="text-sm font-medium">
							Add a Staple
						</label>
						<Input
							autoFocus
							id="new-staple"
							name="displayName"
							value={newStaple}
							onChange={(event) => setNewStaple(event.currentTarget.value)}
							maxLength={200}
							className="mt-1 min-h-11"
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
					{addFetcher.data?.status === 'error' && (
						<p className="text-destructive basis-full text-sm" role="alert">
							{addFetcher.data.message ?? 'Could not add Staple'}
						</p>
					)}
				</addFetcher.Form>
			)}

			{staples.length >= 12 && (
				<div className="mt-4 sm:max-w-sm">
					<label htmlFor="search-staples" className="sr-only">
						Search Staples
					</label>
					<div className="relative sm:max-w-sm">
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
				</div>
			)}

			<p
				className={
					toggleFailed
						? 'text-destructive mt-3 min-h-5 text-sm'
						: 'text-muted-foreground mt-3 min-h-5 text-sm'
				}
				role={toggleFailed ? 'alert' : 'status'}
				aria-live="polite"
			>
				{toggleFeedback}
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
			) : (
				<>
					<StapleGroup
						id="out-staples"
						title="Out"
						description="Waiting in Next shop"
						staples={outStaples}
						countLabel={`${outStaples.length} Out Staple${outStaples.length === 1 ? '' : 's'}`}
						isOut
						emptyMessage="Nothing is Out."
						onToggle={toggleStaple}
						pendingToggleId={pendingToggleId}
						toggleBusy={toggleFetcher.state !== 'idle'}
						toggleButtons={toggleButtons.current}
					/>
					<StapleGroup
						id="available-staples"
						title="Usually available"
						staples={availableStaples}
						countLabel={`${availableStaples.length} usually available Staple${availableStaples.length === 1 ? '' : 's'}`}
						emptyMessage={
							staples.length === 0
								? 'Add a Staple your household normally has.'
								: 'Every Staple is Out.'
						}
						onToggle={toggleStaple}
						pendingToggleId={pendingToggleId}
						toggleBusy={toggleFetcher.state !== 'idle'}
						toggleButtons={toggleButtons.current}
					/>
				</>
			)}

			<details className="border-border mt-10 border-t pt-5">
				<summary className="text-muted-foreground hover:text-foreground flex min-h-11 cursor-pointer items-center text-sm font-medium">
					Advanced
				</summary>
				<p className="text-muted-foreground mt-2 max-w-2xl text-sm">
					Restore the old Pantry experience if you need to recover archived
					inventory. This does not delete these Staples or change Shopping rows.
				</p>
				{confirmRecovery ? (
					<div className="bg-muted/40 mt-4 rounded-lg p-4">
						<p className="text-sm font-medium">Restore the old Pantry now?</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Archived Pantry data will affect Recipe discovery and Shopping
							again.
						</p>
						<recoveryFetcher.Form method="post" className="mt-4 flex gap-3">
							<input
								type="hidden"
								name="intent"
								value="restore-legacy-pantry"
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => setConfirmRecovery(false)}
								disabled={recoveryFetcher.state !== 'idle'}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={recoveryFetcher.state !== 'idle'}>
								{recoveryFetcher.state === 'idle'
									? 'Confirm restore'
									: 'Restoring…'}
							</Button>
						</recoveryFetcher.Form>
					</div>
				) : (
					<Button
						type="button"
						variant="outline"
						className="mt-4"
						onClick={() => setConfirmRecovery(true)}
					>
						Restore old Pantry
					</Button>
				)}
			</details>
		</div>
	)
}

function StapleGroup({
	id,
	title,
	description,
	staples,
	countLabel,
	isOut = false,
	emptyMessage,
	onToggle,
	pendingToggleId,
	toggleBusy,
	toggleButtons,
}: {
	id: string
	title: string
	description?: string
	staples: Array<{ id: string; displayName: string; isOut: boolean }>
	countLabel: string
	isOut?: boolean
	emptyMessage: string
	onToggle: (staple: {
		id: string
		displayName: string
		isOut: boolean
	}) => void
	pendingToggleId: string | null
	toggleBusy: boolean
	toggleButtons: Map<string, HTMLButtonElement>
}) {
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className={
				isOut
					? 'mt-5 overflow-hidden rounded-lg border border-amber-700/20'
					: 'mt-7'
			}
		>
			<div
				className={
					isOut
						? 'flex items-baseline justify-between bg-amber-500/5 px-4 py-3'
						: 'flex items-baseline justify-between border-b pb-2'
				}
			>
				<div>
					<h2 id={`${id}-heading`} className="font-serif text-xl font-normal">
						{title}
					</h2>
					{description && (
						<p className="text-muted-foreground text-sm">{description}</p>
					)}
				</div>
				<span
					aria-label={countLabel}
					className={
						isOut
							? 'rounded-full bg-amber-700/10 px-2.5 py-1 text-sm font-medium text-amber-800 dark:text-amber-300'
							: 'text-muted-foreground text-sm'
					}
				>
					{staples.length}
				</span>
			</div>
			{staples.length > 0 ? (
				<ul
					className={
						isOut
							? 'divide-border/40 divide-y px-4'
							: 'divide-border/40 divide-y'
					}
				>
					{staples.map((staple) => (
						<ActiveStapleRow
							key={staple.id}
							staple={staple}
							onToggle={() => onToggle(staple)}
							isTogglePending={pendingToggleId === staple.id}
							toggleBusy={toggleBusy}
							setToggleButton={(button) => {
								if (button) toggleButtons.set(staple.id, button)
								else toggleButtons.delete(staple.id)
							}}
						/>
					))}
				</ul>
			) : (
				<p
					className={`text-muted-foreground py-5 text-sm ${isOut ? 'px-4' : ''}`}
				>
					{emptyMessage}
				</p>
			)}
		</section>
	)
}

function ActiveStapleRow({
	staple,
	onToggle,
	isTogglePending,
	toggleBusy,
	setToggleButton,
}: {
	staple: { id: string; displayName: string; isOut: boolean }
	onToggle: () => void
	isTogglePending: boolean
	toggleBusy: boolean
	setToggleButton: (button: HTMLButtonElement | null) => void
}) {
	const removeFetcher = useFetcher<CutoverResponse>()
	const [confirmRemove, setConfirmRemove] = useState(false)

	return (
		<li className="w-full min-w-0 py-2">
			<div className="flex min-h-11 w-full min-w-0 items-center gap-3">
				<span
					className={`size-2.5 shrink-0 rounded-full ${staple.isOut ? 'bg-amber-600' : 'bg-primary/35'}`}
					aria-hidden="true"
				/>
				<span className="min-w-0 flex-1 truncate">{staple.displayName}</span>
				<Button
					ref={setToggleButton}
					type="button"
					variant={staple.isOut ? 'secondary' : 'outline'}
					className="min-h-11 min-w-20 shrink-0 px-3"
					aria-label={
						staple.isOut
							? `Mark ${staple.displayName} available`
							: `Mark ${staple.displayName} Out`
					}
					aria-busy={isTogglePending || undefined}
					aria-disabled={toggleBusy || undefined}
					onClick={onToggle}
				>
					{staple.isOut ? 'Available' : 'Out'}
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
					disabled={toggleBusy || removeFetcher.state !== 'idle'}
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
