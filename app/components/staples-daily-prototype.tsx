import { useMemo, useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { cn } from '#app/utils/misc.tsx'
import {
	PrototypeSwitcher,
	type PrototypeVariant,
} from './prototype-switcher.tsx'

// PROTOTYPE — Task-first Staples layouts, switchable with ?variant=A|B|C|D on
// the existing /inventory route. Mutations live only in component state.

type PrototypeStaple = {
	id: string
	displayName: string
	isOut: boolean
}

const VARIANTS: PrototypeVariant[] = [
	{ key: 'A', label: 'Restock queue' },
	{ key: 'D', label: 'Split status' },
	{ key: 'B', label: 'Filterable ledger' },
	{ key: 'C', label: 'Trip board' },
]

export function StaplesDailyPrototype({
	initialStaples,
	archivedInventoryCount,
	variant,
}: {
	initialStaples: PrototypeStaple[]
	archivedInventoryCount: number
	variant: string
}) {
	const [staples, setStaples] = useState(initialStaples)
	const [search, setSearch] = useState('')
	const [feedback, setFeedback] = useState('')
	const [addOpen, setAddOpen] = useState(false)
	const [newName, setNewName] = useState('')

	const filtered = useMemo(() => {
		const query = search.trim().toLocaleLowerCase()
		return query
			? staples.filter((staple) =>
					staple.displayName.toLocaleLowerCase().includes(query),
				)
			: staples
	}, [search, staples])

	function toggle(staple: PrototypeStaple) {
		const isOut = !staple.isOut
		setStaples((current) =>
			current.map((item) =>
				item.id === staple.id ? { ...item, isOut } : item,
			),
		)
		setFeedback(
			isOut
				? `${staple.displayName} added to Next shop.`
				: `${staple.displayName} is no longer Out. It remains in Next shop.`,
		)
	}

	function remove(staple: PrototypeStaple) {
		setStaples((current) => current.filter((item) => item.id !== staple.id))
		setFeedback(`${staple.displayName} removed from Staples.`)
	}

	function add(event: React.FormEvent) {
		event.preventDefault()
		const displayName = newName.trim()
		if (!displayName) return
		setStaples((current) => [
			...current,
			{ id: `prototype-${Date.now()}`, displayName, isOut: false },
		])
		setFeedback(`${displayName} added to Staples.`)
		setNewName('')
		setAddOpen(false)
	}

	const shared = {
		staples,
		filtered,
		search,
		setSearch,
		feedback,
		addOpen,
		setAddOpen,
		newName,
		setNewName,
		add,
		toggle,
		remove,
		archivedInventoryCount,
	}

	return (
		<>
			{variant === 'D' ? (
				<SplitStatusQueue {...shared} />
			) : variant === 'B' ? (
				<FilterableLedger {...shared} />
			) : variant === 'C' ? (
				<TripBoard {...shared} />
			) : (
				<RestockQueue {...shared} />
			)}
			<PrototypeSwitcher variants={VARIANTS} current={variant} />
		</>
	)
}

function SplitStatusQueue(props: VariantProps) {
	const out = alphabetize(props.filtered.filter((staple) => staple.isOut))
	const available = alphabetize(
		props.filtered.filter((staple) => !staple.isOut),
	)
	const totalOut = props.staples.filter((staple) => staple.isOut).length

	return (
		<PrototypePage>
			<PageHeader
				title="Staples"
				description="Things you usually have. Mark one Out to add it to Next shop."
				onAdd={() => props.setAddOpen(!props.addOpen)}
			/>
			<InlineAdd {...props} />
			{props.staples.length >= 12 && (
				<Search value={props.search} onChange={props.setSearch} />
			)}
			<LiveFeedback>{props.feedback}</LiveFeedback>

			<section className="mt-5 overflow-hidden rounded-lg border border-amber-700/20">
				<div className="flex items-baseline justify-between bg-amber-500/5 px-4 py-3">
					<div>
						<h2 className="font-serif text-xl font-normal">Out</h2>
						<p className="text-muted-foreground text-sm">
							Waiting in Next shop
						</p>
					</div>
					<span className="rounded-full bg-amber-700/10 px-2.5 py-1 text-sm font-medium text-amber-800 dark:text-amber-300">
						{totalOut}
					</span>
				</div>
				{out.length ? (
					<div className="divide-border/40 divide-y px-4">
						{out.map((staple) => (
							<StatusActionRow
								key={staple.id}
								staple={staple}
								onAction={() => props.toggle(staple)}
								onRemove={() => props.remove(staple)}
							/>
						))}
					</div>
				) : (
					<p className="text-muted-foreground px-4 py-5 text-sm">
						Nothing is Out.
					</p>
				)}
			</section>

			<section className="mt-7">
				<div className="flex items-baseline justify-between border-b pb-2">
					<h2 className="font-serif text-xl font-normal">Usually available</h2>
					<span className="text-muted-foreground text-sm">
						{props.staples.length - totalOut}
					</span>
				</div>
				{available.length ? (
					<div className="divide-border/40 divide-y">
						{available.map((staple) => (
							<StatusActionRow
								key={staple.id}
								staple={staple}
								onAction={() => props.toggle(staple)}
								onRemove={() => props.remove(staple)}
							/>
						))}
					</div>
				) : (
					<p className="text-muted-foreground py-5 text-sm">
						{props.search
							? 'No available Staples match this search.'
							: 'Every Staple is Out.'}
					</p>
				)}
			</section>
			<RecoveryDetails count={props.archivedInventoryCount} />
		</PrototypePage>
	)
}

type VariantProps = {
	staples: PrototypeStaple[]
	filtered: PrototypeStaple[]
	search: string
	setSearch: (value: string) => void
	feedback: string
	addOpen: boolean
	setAddOpen: (value: boolean) => void
	newName: string
	setNewName: (value: string) => void
	add: (event: React.FormEvent) => void
	toggle: (staple: PrototypeStaple) => void
	remove: (staple: PrototypeStaple) => void
	archivedInventoryCount: number
}

function RestockQueue(props: VariantProps) {
	const out = alphabetize(props.filtered.filter((staple) => staple.isOut))
	const available = alphabetize(
		props.filtered.filter((staple) => !staple.isOut),
	)
	const totalOut = props.staples.filter((staple) => staple.isOut).length

	return (
		<PrototypePage>
			<PageHeader
				title="Staples"
				description="Things you usually have. Mark one Out to add it to Next shop."
				onAdd={() => props.setAddOpen(!props.addOpen)}
			/>
			<InlineAdd {...props} />
			{props.staples.length >= 12 && (
				<Search value={props.search} onChange={props.setSearch} />
			)}
			<LiveFeedback>{props.feedback}</LiveFeedback>

			<section className="mt-5 rounded-lg border border-amber-700/20 bg-amber-500/5">
				<div className="flex items-baseline justify-between px-4 pt-4 pb-2">
					<div>
						<h2 className="font-serif text-xl font-normal">Out</h2>
						<p className="text-muted-foreground text-sm">
							Waiting in Next shop
						</p>
					</div>
					<span className="rounded-full bg-amber-700/10 px-2.5 py-1 text-sm font-medium text-amber-800 dark:text-amber-300">
						{totalOut}
					</span>
				</div>
				{out.length ? (
					<div className="divide-border/40 divide-y px-4 pb-2">
						{out.map((staple) => (
							<NamedActionRow
								key={staple.id}
								staple={staple}
								action="Mark available"
								onAction={() => props.toggle(staple)}
								onRemove={() => props.remove(staple)}
							/>
						))}
					</div>
				) : (
					<p className="text-muted-foreground px-4 pt-1 pb-5 text-sm">
						Nothing is Out.
					</p>
				)}
			</section>

			<section className="mt-7">
				<div className="flex items-baseline justify-between border-b pb-2">
					<h2 className="font-serif text-xl font-normal">Usually available</h2>
					<span className="text-muted-foreground text-sm">
						{props.staples.length - totalOut}
					</span>
				</div>
				{available.length ? (
					<div className="divide-border/40 divide-y">
						{available.map((staple) => (
							<NamedActionRow
								key={staple.id}
								staple={staple}
								action="Mark Out"
								onAction={() => props.toggle(staple)}
								onRemove={() => props.remove(staple)}
							/>
						))}
					</div>
				) : (
					<p className="text-muted-foreground py-5 text-sm">
						{props.search
							? 'No available Staples match this search.'
							: 'Every Staple is Out.'}
					</p>
				)}
			</section>
			<RecoveryDetails count={props.archivedInventoryCount} />
		</PrototypePage>
	)
}

function FilterableLedger(props: VariantProps) {
	const [filter, setFilter] = useState<'all' | 'out'>('all')
	const totalOut = props.staples.filter((staple) => staple.isOut).length
	const visible = alphabetize(
		props.filtered.filter((staple) => filter === 'all' || staple.isOut),
	)

	return (
		<PrototypePage>
			<PageHeader
				title="Staples"
				description="Your household defaults, with Out items sent straight to Next shop."
				onAdd={() => props.setAddOpen(!props.addOpen)}
			/>
			<InlineAdd {...props} />
			<div className="mt-5 flex items-center gap-2">
				<div
					className="bg-muted/60 flex rounded-lg p-1"
					aria-label="Filter Staples"
				>
					<button
						type="button"
						className={cn(
							'min-h-10 rounded-md px-4 text-sm',
							filter === 'all' && 'bg-background shadow-sm',
						)}
						onClick={() => setFilter('all')}
					>
						All {props.staples.length}
					</button>
					<button
						type="button"
						className={cn(
							'min-h-10 rounded-md px-4 text-sm',
							filter === 'out' && 'bg-background shadow-sm',
						)}
						onClick={() => setFilter('out')}
					>
						Out {totalOut}
					</button>
				</div>
				<div className="min-w-0 flex-1">
					<Search value={props.search} onChange={props.setSearch} compact />
				</div>
			</div>
			<LiveFeedback>{props.feedback}</LiveFeedback>
			<div className="mt-4 divide-y">
				{visible.length ? (
					visible.map((staple) => (
						<div
							key={staple.id}
							className="flex min-h-14 items-center gap-3 py-2"
						>
							<span
								className={cn(
									'size-2.5 shrink-0 rounded-full',
									staple.isOut ? 'bg-amber-600' : 'bg-primary/35',
								)}
								aria-hidden="true"
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate">{staple.displayName}</p>
								<p className="text-muted-foreground text-xs">
									{staple.isOut ? 'Out · in Next shop' : 'Usually available'}
								</p>
							</div>
							<Button
								type="button"
								variant={staple.isOut ? 'secondary' : 'outline'}
								className="min-h-11"
								onClick={() => props.toggle(staple)}
							>
								{staple.isOut ? 'Available' : 'Out'}
							</Button>
							<RemoveButton
								staple={staple}
								onRemove={() => props.remove(staple)}
							/>
						</div>
					))
				) : (
					<NoResults
						search={props.search}
						onClear={() => props.setSearch('')}
					/>
				)}
			</div>
			<RecoveryDetails count={props.archivedInventoryCount} />
		</PrototypePage>
	)
}

function TripBoard(props: VariantProps) {
	const out = alphabetize(props.filtered.filter((staple) => staple.isOut))
	const available = alphabetize(
		props.filtered.filter((staple) => !staple.isOut),
	)
	const totalOut = props.staples.filter((staple) => staple.isOut).length

	return (
		<PrototypePage>
			<div className="bg-primary text-primary-foreground rounded-xl px-5 py-5">
				<p className="text-xs font-medium tracking-wider uppercase opacity-75">
					Staples
				</p>
				<div className="mt-2 flex items-end justify-between gap-4">
					<div>
						<h1 className="font-serif text-3xl font-normal">Need this trip</h1>
						<p className="mt-1 text-sm opacity-80">
							{totalOut
								? `${totalOut} waiting in Next shop`
								: 'Nothing waiting in Next shop'}
						</p>
					</div>
					<span className="font-serif text-5xl leading-none">{totalOut}</span>
				</div>
			</div>

			<LiveFeedback>{props.feedback}</LiveFeedback>
			<section className="mt-4">
				{out.length ? (
					<div className="grid gap-2 sm:grid-cols-2">
						{out.map((staple) => (
							<div
								key={staple.id}
								className="bg-muted/50 flex items-center gap-3 rounded-lg p-3"
							>
								<Icon
									name="cookie"
									className="size-5 shrink-0 text-amber-700"
								/>
								<span className="min-w-0 flex-1 truncate font-medium">
									{staple.displayName}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => props.toggle(staple)}
								>
									Got it
								</Button>
							</div>
						))}
					</div>
				) : (
					<div className="border-border rounded-lg border border-dashed p-5 text-center">
						<Icon name="check" className="text-primary mx-auto size-6" />
						<p className="mt-2 font-medium">Nothing is Out</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Your usual Staples are accounted for.
						</p>
					</div>
				)}
			</section>

			<section className="mt-8">
				<div className="flex flex-wrap items-center gap-3">
					<div className="min-w-44 flex-1">
						<h2 className="font-serif text-xl font-normal">
							Usually available
						</h2>
						<p className="text-muted-foreground text-sm">
							Tap Need when something runs out.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => props.setAddOpen(!props.addOpen)}
					>
						<Icon name="plus" size="sm" /> Add
					</Button>
				</div>
				<InlineAdd {...props} />
				{props.staples.length >= 8 && (
					<Search value={props.search} onChange={props.setSearch} />
				)}
				<div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
					{available.length ? (
						available.map((staple) => (
							<div
								key={staple.id}
								className="border-border flex min-h-14 items-center gap-2 rounded-lg border px-3 py-2"
							>
								<span className="min-w-0 flex-1 truncate">
									{staple.displayName}
								</span>
								<button
									type="button"
									className="text-primary hover:bg-primary/10 min-h-10 rounded-md px-3 text-sm font-medium"
									onClick={() => props.toggle(staple)}
								>
									Need
								</button>
								<RemoveButton
									staple={staple}
									onRemove={() => props.remove(staple)}
								/>
							</div>
						))
					) : (
						<NoResults
							search={props.search}
							onClear={() => props.setSearch('')}
						/>
					)}
				</div>
			</section>
			<RecoveryDetails count={props.archivedInventoryCount} />
		</PrototypePage>
	)
}

function PrototypePage({ children }: { children: React.ReactNode }) {
	return (
		<main className="container-content w-full min-w-0 overflow-x-hidden py-4 pb-36 md:py-6 md:pb-24">
			{children}
		</main>
	)
}

function PageHeader({
	title,
	description,
	onAdd,
}: {
	title: string
	description: string
	onAdd: () => void
}) {
	return (
		<header>
			<div className="flex items-start justify-between gap-4">
				<h1 className="font-serif text-2xl font-normal">{title}</h1>
				<Button
					type="button"
					variant="outline"
					className="min-h-11 shrink-0"
					onClick={onAdd}
				>
					<Icon name="plus" size="sm" /> Add
				</Button>
			</div>
			<p className="text-muted-foreground mt-1 max-w-xl text-sm">
				{description}
			</p>
		</header>
	)
}

function InlineAdd(props: VariantProps) {
	if (!props.addOpen) return null
	return (
		<form
			onSubmit={props.add}
			className="bg-muted/40 mt-4 flex items-end gap-2 rounded-lg p-3"
		>
			<label className="min-w-0 flex-1 text-sm font-medium">
				Add a Staple
				<Input
					autoFocus
					value={props.newName}
					onChange={(event) => props.setNewName(event.currentTarget.value)}
					className="mt-1 min-h-11"
				/>
			</label>
			<Button
				type="submit"
				className="min-h-11"
				disabled={!props.newName.trim()}
			>
				Add
			</Button>
		</form>
	)
}

function Search({
	value,
	onChange,
	compact = false,
}: {
	value: string
	onChange: (value: string) => void
	compact?: boolean
}) {
	return (
		<label className={cn('relative block', compact ? '' : 'mt-4 sm:max-w-sm')}>
			<span className="sr-only">Search Staples</span>
			<Icon
				name="magnifying-glass"
				size="sm"
				className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
			/>
			<Input
				type="search"
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				placeholder="Search"
				className="min-h-11 pl-9"
			/>
		</label>
	)
}

function LiveFeedback({ children }: { children: React.ReactNode }) {
	return (
		<p
			className="text-muted-foreground mt-3 min-h-5 text-sm"
			role="status"
			aria-live="polite"
		>
			{children}
		</p>
	)
}

function NamedActionRow({
	staple,
	action,
	onAction,
	onRemove,
}: {
	staple: PrototypeStaple
	action: string
	onAction: () => void
	onRemove: () => void
}) {
	return (
		<div className="flex min-h-14 items-center gap-2 py-2">
			<span className="min-w-0 flex-1 truncate">{staple.displayName}</span>
			<Button
				type="button"
				variant="outline"
				className="min-h-11 shrink-0"
				onClick={onAction}
			>
				{action}
			</Button>
			<RemoveButton staple={staple} onRemove={onRemove} />
		</div>
	)
}

function StatusActionRow({
	staple,
	onAction,
	onRemove,
}: {
	staple: PrototypeStaple
	onAction: () => void
	onRemove: () => void
}) {
	return (
		<div className="flex min-h-14 items-center gap-3 py-2">
			<span
				className={cn(
					'size-2.5 shrink-0 rounded-full',
					staple.isOut ? 'bg-amber-600' : 'bg-primary/35',
				)}
				aria-hidden="true"
			/>
			<span className="min-w-0 flex-1 truncate">{staple.displayName}</span>
			<Button
				type="button"
				variant={staple.isOut ? 'secondary' : 'outline'}
				className="min-h-11 min-w-20 shrink-0"
				aria-label={`${staple.displayName}: mark ${staple.isOut ? 'available' : 'Out'}`}
				onClick={onAction}
			>
				{staple.isOut ? 'Available' : 'Out'}
			</Button>
			<RemoveButton staple={staple} onRemove={onRemove} />
		</div>
	)
}

function RemoveButton({
	staple,
	onRemove,
}: {
	staple: PrototypeStaple
	onRemove: () => void
}) {
	return (
		<button
			type="button"
			className="text-muted-foreground hover:bg-muted flex size-11 shrink-0 items-center justify-center rounded-md"
			aria-label={`Remove ${staple.displayName}`}
			onClick={onRemove}
		>
			<Icon name="trash" size="sm" />
		</button>
	)
}

function NoResults({
	search,
	onClear,
}: {
	search: string
	onClear: () => void
}) {
	return (
		<div className="col-span-full py-8 text-center">
			<p className="font-medium">No Staples match &ldquo;{search}&rdquo;</p>
			<Button type="button" variant="link" onClick={onClear}>
				Clear search
			</Button>
		</div>
	)
}

function RecoveryDetails({ count }: { count: number }) {
	if (count === 0) return null
	return (
		<details className="border-border mt-10 border-t pt-5 text-sm">
			<summary className="text-muted-foreground cursor-pointer">
				Advanced
			</summary>
			<div className="bg-muted/40 mt-3 rounded-lg p-4">
				<p className="font-medium">Restore the old Pantry</p>
				<p className="text-muted-foreground mt-1">
					Restore {count} archived {count === 1 ? 'item' : 'items'} if you need
					to undo the Staples switch.
				</p>
				<Button type="button" variant="outline" size="sm" className="mt-3">
					Restore Pantry
				</Button>
			</div>
		</details>
	)
}

function alphabetize(staples: PrototypeStaple[]) {
	return [...staples].sort((a, b) =>
		a.displayName.localeCompare(b.displayName, undefined, {
			sensitivity: 'base',
		}),
	)
}
