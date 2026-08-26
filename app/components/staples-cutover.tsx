import { useEffect, useMemo, useState } from 'react'
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
	archivedInventoryCount,
}: {
	staples: Array<{
		id: string
		displayName: string
		isOut: boolean
	}>
	archivedInventoryCount: number
}) {
	const recoveryFetcher = useFetcher<CutoverResponse>()
	const addFetcher = useFetcher<CutoverResponse>()
	const [confirmRecovery, setConfirmRecovery] = useState(false)
	const [search, setSearch] = useState('')
	const [newStaple, setNewStaple] = useState('')
	const filteredStaples = useMemo(() => {
		const query = search.trim().toLowerCase()
		return query
			? staples.filter((staple) =>
					staple.displayName.toLowerCase().includes(query),
				)
			: staples
	}, [search, staples])

	useEffect(() => {
		if (
			addFetcher.state === 'idle' &&
			addFetcher.data?.status === 'success' &&
			addFetcher.data.action === 'add-staple'
		) {
			setNewStaple('')
		}
	}, [addFetcher.data, addFetcher.state])

	return (
		<div className="container-content w-full min-w-0 overflow-x-hidden py-4 pb-24 md:py-6 md:pb-8">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="font-serif text-2xl font-normal">Staples</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						{staples.length} household Staple{staples.length === 1 ? '' : 's'}
					</p>
				</div>
			</div>

			<addFetcher.Form
				method="post"
				className="bg-muted/40 mt-6 rounded-lg p-4 sm:flex sm:items-end sm:gap-3"
			>
				<input type="hidden" name="intent" value="add-staple" />
				<div className="min-w-0 flex-1">
					<label htmlFor="new-staple" className="text-sm font-medium">
						Add a Staple
					</label>
					<p className="text-muted-foreground mt-1 text-xs">
						Add an ingredient your household normally keeps around.
					</p>
					<Input
						id="new-staple"
						name="displayName"
						value={newStaple}
						onChange={(event) => setNewStaple(event.currentTarget.value)}
						maxLength={200}
						className="mt-3 min-h-11"
						disabled={addFetcher.state !== 'idle'}
					/>
				</div>
				<Button
					type="submit"
					className="mt-3 min-h-11 w-full sm:mt-0 sm:w-auto"
					disabled={!newStaple.trim() || addFetcher.state !== 'idle'}
				>
					<Icon name="plus" size="sm" />
					{addFetcher.state === 'idle' ? 'Add' : 'Adding…'}
				</Button>
				{addFetcher.data?.status === 'error' && (
					<p
						className="text-destructive mt-2 text-sm sm:basis-full"
						role="alert"
					>
						{addFetcher.data.message ?? 'Could not add Staple'}
					</p>
				)}
			</addFetcher.Form>

			<div className="mt-5">
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
						placeholder="Search Staples"
						className="min-h-11 pl-9"
					/>
				</div>
			</div>

			<div className="mt-4">
				{staples.length > 0 ? (
					filteredStaples.length > 0 ? (
						<div className="divide-border/40 divide-y">
							{filteredStaples.map((staple) => (
								<ActiveStapleRow key={staple.id} staple={staple} />
							))}
						</div>
					) : (
						<div className="bg-muted/40 rounded-lg p-6 text-center">
							<h2 className="font-serif text-xl font-normal">
								No Staples match &ldquo;{search.trim()}&rdquo;
							</h2>
							<Button
								type="button"
								variant="outline"
								className="mt-4 min-h-11"
								onClick={() => setSearch('')}
							>
								Clear search
							</Button>
						</div>
					)
				) : (
					<div className="bg-muted/40 rounded-lg p-6 text-center">
						<h2 className="font-serif text-xl font-normal">
							No Staples selected
						</h2>
						<p className="text-muted-foreground mt-2 text-sm">
							This household intentionally confirmed an empty Staple list.
						</p>
					</div>
				)}
			</div>

			<div className="border-border mt-10 border-t pt-6">
				<h2 className="font-medium">Cutover recovery</h2>
				<p className="text-muted-foreground mt-2 max-w-2xl text-sm">
					{archivedInventoryCount} legacy Pantry item
					{archivedInventoryCount === 1 ? '' : 's'} remain archived. Restoring
					Pantry clears only the cutover timestamp; it does not delete these
					Staples or change Shopping rows.
				</p>
				{confirmRecovery ? (
					<div className="bg-muted/40 mt-4 rounded-lg p-4">
						<p className="text-sm font-medium">
							Restore legacy Pantry behavior now?
						</p>
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
						Restore Pantry
					</Button>
				)}
			</div>
		</div>
	)
}

function ActiveStapleRow({
	staple,
}: {
	staple: { id: string; displayName: string; isOut: boolean }
}) {
	const toggleFetcher = useFetcher<CutoverResponse>()
	const removeFetcher = useFetcher<CutoverResponse>()
	const [confirmRemove, setConfirmRemove] = useState(false)
	const optimisticOut =
		toggleFetcher.formData?.get('intent') === 'toggle-staple-out'
			? !staple.isOut
			: staple.isOut

	if (removeFetcher.state !== 'idle') return null

	return (
		<div className="flex min-h-14 w-full min-w-0 items-center gap-3 py-2">
			<span className="min-w-0 flex-1 truncate">{staple.displayName}</span>
			<toggleFetcher.Form method="post" className="shrink-0">
				<input type="hidden" name="intent" value="toggle-staple-out" />
				<input type="hidden" name="itemId" value={staple.id} />
				<Button
					type="submit"
					variant={optimisticOut ? 'default' : 'outline'}
					className="min-h-11 min-w-16 px-3"
					aria-pressed={optimisticOut}
					aria-label={
						optimisticOut
							? `Mark ${staple.displayName} not Out`
							: `Mark ${staple.displayName} Out`
					}
					disabled={toggleFetcher.state !== 'idle'}
				>
					{optimisticOut && <Icon name="check" size="sm" />}
					Out
				</Button>
			</toggleFetcher.Form>
			<Button
				type="button"
				variant={confirmRemove ? 'destructive' : 'ghost'}
				className="min-h-11 min-w-11 px-3"
				aria-label={
					confirmRemove
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
			>
				<Icon name="trash" size="sm" />
				{confirmRemove && <span>Remove?</span>}
			</Button>
		</div>
	)
}
