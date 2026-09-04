import { useMemo, useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { cn } from '#app/utils/misc.tsx'
import {
	PrototypeSwitcher,
	type PrototypeVariant,
} from './prototype-switcher.tsx'

// PROTOTYPE — Three compact Staples header compositions, switchable with
// ?variant=A|B|C on the existing /inventory route. Mutations live only in
// component state.

type PrototypeStaple = {
	id: string
	displayName: string
	isOut: boolean
}

const VARIANTS: PrototypeVariant[] = [
	{ key: 'A', label: 'Unified toolbar' },
	{ key: 'B', label: 'Quiet title actions' },
	{ key: 'C', label: 'Two-field utility row' },
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
			<SplitStatusQueue
				{...shared}
				headerVariant={variant === 'B' || variant === 'C' ? variant : 'A'}
			/>
			<PrototypeSwitcher variants={VARIANTS} current={variant} />
		</>
	)
}

function SplitStatusQueue(
	props: VariantProps & { headerVariant: 'A' | 'B' | 'C' },
) {
	const out = alphabetize(props.filtered.filter((staple) => staple.isOut))
	const available = alphabetize(
		props.filtered.filter((staple) => !staple.isOut),
	)
	const totalOut = props.staples.filter((staple) => staple.isOut).length

	return (
		<PrototypePage>
			<HeaderPass {...props} variant={props.headerVariant} />
			{props.feedback ? <LiveFeedback>{props.feedback}</LiveFeedback> : null}

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

function HeaderPass({
	variant,
	...props
}: VariantProps & { variant: 'A' | 'B' | 'C' }) {
	if (variant === 'B') return <QuietTitleActions {...props} />
	if (variant === 'C') return <TwoFieldUtilityRow {...props} />
	return <UnifiedToolbar {...props} />
}

function HeaderCopy() {
	return (
		<div className="min-w-0">
			<h1 className="font-serif text-2xl font-normal">Staples</h1>
			<p className="text-muted-foreground mt-1 max-w-xl text-sm">
				Things you usually have. Mark one Out to add it to Next shop.
			</p>
		</div>
	)
}

function UnifiedToolbar(props: VariantProps) {
	return (
		<header>
			<HeaderCopy />
			{props.addOpen ? (
				<form onSubmit={props.add} className="mt-4 flex items-center gap-2">
					<label className="min-w-0 flex-1">
						<span className="sr-only">Staple name</span>
						<Input
							autoFocus
							value={props.newName}
							onChange={(event) => props.setNewName(event.currentTarget.value)}
							placeholder="Staple name"
							className="min-h-11"
						/>
					</label>
					<Button type="submit" disabled={!props.newName.trim()}>
						Add
					</Button>
					<Button
						type="button"
						variant="ghost"
						className="min-h-11"
						onClick={() => props.setAddOpen(false)}
					>
						Cancel
					</Button>
				</form>
			) : (
				<div className="mt-4 flex items-center gap-2">
					<div className="min-w-0 flex-1 sm:max-w-md">
						<Search value={props.search} onChange={props.setSearch} compact />
					</div>
					<Button
						type="button"
						variant="outline"
						className="min-h-11 shrink-0"
						onClick={() => props.setAddOpen(true)}
					>
						<Icon name="plus" size="sm" /> Add
					</Button>
				</div>
			)}
		</header>
	)
}

function QuietTitleActions(props: VariantProps) {
	const [searchOpen, setSearchOpen] = useState(false)
	return (
		<header>
			<div className="flex items-start justify-between gap-4">
				<HeaderCopy />
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-11 items-center justify-center rounded-md"
						aria-label="Search Staples"
						onClick={() => setSearchOpen((open) => !open)}
					>
						<Icon name="magnifying-glass" size="sm" />
					</button>
					<Button
						type="button"
						variant="ghost"
						className="min-h-11"
						onClick={() => props.setAddOpen(!props.addOpen)}
					>
						<Icon name="plus" size="sm" /> Add
					</Button>
				</div>
			</div>
			{props.addOpen ? (
				<form
					onSubmit={props.add}
					className="border-border mt-4 flex items-center gap-2 border-b pb-3"
				>
					<label className="min-w-0 flex-1">
						<span className="sr-only">Staple name</span>
						<input
							autoFocus
							value={props.newName}
							onChange={(event) => props.setNewName(event.currentTarget.value)}
							placeholder="What do you usually keep around?"
							className="placeholder:text-muted-foreground h-11 w-full bg-transparent px-1 outline-none"
						/>
					</label>
					<Button type="submit" size="sm" disabled={!props.newName.trim()}>
						Add
					</Button>
				</form>
			) : searchOpen ? (
				<div className="mt-4 sm:max-w-md">
					<Search value={props.search} onChange={props.setSearch} compact />
				</div>
			) : null}
		</header>
	)
}

function TwoFieldUtilityRow(props: VariantProps) {
	return (
		<header>
			<HeaderCopy />
			<div className="mt-4 grid gap-2 sm:grid-cols-2">
				<Search value={props.search} onChange={props.setSearch} compact />
				<form onSubmit={props.add} className="relative">
					<label>
						<span className="sr-only">Add a Staple</span>
						<Icon
							name="plus"
							size="sm"
							className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<Input
							value={props.newName}
							onChange={(event) => props.setNewName(event.currentTarget.value)}
							placeholder="Add a Staple"
							className="min-h-11 pr-16 pl-9"
						/>
					</label>
					<button
						type="submit"
						disabled={!props.newName.trim()}
						className="text-primary disabled:text-muted-foreground absolute top-0 right-0 min-h-11 px-3 text-sm font-medium disabled:opacity-50"
					>
						Add
					</button>
				</form>
			</div>
		</header>
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

function PrototypePage({ children }: { children: React.ReactNode }) {
	return (
		<main className="container-content w-full min-w-0 overflow-x-hidden py-4 pb-36 md:py-6 md:pb-24">
			{children}
		</main>
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
