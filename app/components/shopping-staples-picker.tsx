import { useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '#app/components/ui/popover.tsx'
import { cn } from '#app/utils/misc.tsx'
import { NEXT_SHOP } from '#app/utils/shopping-horizon.ts'

export type ShoppingStaple = {
	id: string
	displayName: string
	onShoppingList: boolean
}

type BulkAddResponse = {
	status: 'success'
	addedCount: number
	moveItemIds: string[]
}

export function ShoppingStaplesPicker({
	staples,
	showQuietCue,
}: {
	staples: ShoppingStaple[]
	showQuietCue: boolean
}) {
	const fetcher = useFetcher<BulkAddResponse>()
	const moveFetcher = useFetcher()
	const previousFetcherState = useRef(fetcher.state)
	const [open, setOpen] = useState(false)
	const [cueDismissed, setCueDismissed] = useState(false)
	const [selected, setSelected] = useState<Set<string>>(() => new Set())
	const [search, setSearch] = useState('')

	const availableStaples = staples.filter((staple) => !staple.onShoppingList)
	const availableIds = new Set(availableStaples.map((staple) => staple.id))
	const selectedStaples = availableStaples.filter((staple) =>
		selected.has(staple.id),
	)
	const showCue = showQuietCue && availableStaples.length > 0 && !cueDismissed
	const visibleStaples = useMemo(() => {
		const query = search.trim().toLowerCase()
		return query
			? staples.filter((staple) =>
					staple.displayName.toLowerCase().includes(query),
				)
			: staples
	}, [search, staples])

	useEffect(() => {
		if (
			previousFetcherState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data?.status === 'success'
		) {
			const { addedCount, moveItemIds } = fetcher.data
			if (addedCount > 0) {
				toast.success(`Added ${addedCount} item${addedCount === 1 ? '' : 's'}`)
			} else if (moveItemIds.length === 0) {
				toast.info('Nothing changed')
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
								void moveFetcher.submit(data, { method: 'POST' })
							},
						},
					},
				)
			}
			setOpen(false)
			setSelected(new Set())
			setSearch('')
		}
		previousFetcherState.current = fetcher.state
	}, [fetcher.data, fetcher.state, moveFetcher])

	if (staples.length === 0) return null

	function toggleStaple(id: string) {
		if (!availableIds.has(id)) return
		setSelected((current) => {
			const next = new Set(current)
			next.has(id) ? next.delete(id) : next.add(id)
			return next
		})
	}

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen)
				if (nextOpen) setCueDismissed(true)
				else setSearch('')
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="relative"
					aria-label={
						showCue ? 'From Staples, reminder available' : 'From Staples'
					}
				>
					<Icon name="cookie" size="sm" />
					From Staples
					{showCue && (
						<span
							className="bg-accent ring-background absolute -top-1 -right-1 size-2.5 rounded-full ring-2"
							aria-hidden="true"
						/>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
				<h2 className="font-serif text-lg">What do you need this trip?</h2>
				<p className="text-muted-foreground mt-1 text-sm">
					Pick Staples to add to Next shop.
				</p>
				{staples.length >= 10 && (
					<div className="relative mt-3">
						<Icon
							name="magnifying-glass"
							size="sm"
							className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<Input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.currentTarget.value)}
							placeholder="Search Staples"
							aria-label="Search Staples"
							className="min-h-11 pl-9"
						/>
					</div>
				)}
				<div className="mt-3 max-h-64 divide-y overflow-y-auto">
					{visibleStaples.length > 0 ? (
						visibleStaples.map((staple) => {
							const isSelected =
								!staple.onShoppingList && selected.has(staple.id)
							return (
								<button
									key={staple.id}
									type="button"
									disabled={staple.onShoppingList}
									onClick={() => toggleStaple(staple.id)}
									aria-pressed={isSelected}
									className="flex min-h-11 w-full items-center gap-3 py-2 text-left disabled:opacity-45"
								>
									<span
										className={cn(
											'flex size-5 shrink-0 items-center justify-center rounded border',
											isSelected
												? 'border-primary bg-primary text-primary-foreground'
												: 'border-border bg-background',
										)}
									>
										{isSelected && <Icon name="check" size="xs" />}
									</span>
									<span className="min-w-0 flex-1 truncate">
										{staple.displayName}
									</span>
									{staple.onShoppingList && (
										<span className="text-muted-foreground text-xs">
											On list
										</span>
									)}
								</button>
							)
						})
					) : (
						<p className="text-muted-foreground py-6 text-center text-sm">
							No Staples match &ldquo;{search.trim()}&rdquo;
						</p>
					)}
				</div>
				<fetcher.Form method="POST">
					<input type="hidden" name="intent" value="bulk-add" />
					<input type="hidden" name="horizon" value={NEXT_SHOP} />
					<input
						type="hidden"
						name="items"
						value={JSON.stringify(
							selectedStaples.map((staple) => ({
								name: staple.displayName,
							})),
						)}
					/>
					<Button
						type="submit"
						className="mt-4 w-full"
						disabled={selectedStaples.length === 0 || fetcher.state !== 'idle'}
					>
						{fetcher.state === 'idle'
							? selectedStaples.length > 0
								? `Add ${selectedStaples.length} to Next shop`
								: 'Add to Next shop'
							: 'Adding…'}
					</Button>
				</fetcher.Form>
			</PopoverContent>
		</Popover>
	)
}
