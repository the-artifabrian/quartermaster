import { useFetcher } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'

export type LowStockItem = {
	id: string
	name: string
	location: string
	quantity: number | null
	unit: string | null
}

export function LowStockNudge({ items }: { items: LowStockItem[] }) {
	const addAllFetcher = useFetcher()
	const isAddingAll = addAllFetcher.state !== 'idle'

	return (
		<div className="mb-6 rounded-lg bg-accent/8 p-4 print:hidden">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h3 className="text-[0.75rem] font-medium tracking-[0.08em] uppercase text-accent">
					Running low
				</h3>
				<addAllFetcher.Form method="POST">
					<input type="hidden" name="intent" value="add-all-low-stock" />
					<input
						type="hidden"
						name="names"
						value={JSON.stringify(items.map((i) => i.name))}
					/>
					<button
						type="submit"
						className="text-xs text-accent underline underline-offset-2 hover:text-accent/80 disabled:opacity-50"
						disabled={isAddingAll}
					>
						{isAddingAll ? 'Adding...' : `Add all (${items.length})`}
					</button>
				</addAllFetcher.Form>
			</div>
			<div className="flex flex-wrap gap-2">
				{items.map((item) => (
					<LowStockChip key={item.id} item={item} />
				))}
			</div>
		</div>
	)
}

function LowStockChip({ item }: { item: LowStockItem }) {
	const fetcher = useFetcher()
	const isAdding = fetcher.state !== 'idle'

	if (isAdding) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
				<Icon name="check" className="size-3" />
				{item.name}
			</span>
		)
	}

	return (
		<fetcher.Form method="POST">
			<input type="hidden" name="intent" value="add-low-stock" />
			<input type="hidden" name="itemName" value={item.name} />
			<button
				type="submit"
				className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-accent/30 hover:bg-accent/5"
			>
				{item.name}
				<Icon name="plus" className="size-3 text-muted-foreground" />
			</button>
		</fetcher.Form>
	)
}
