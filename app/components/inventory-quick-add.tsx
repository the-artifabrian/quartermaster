import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type InventoryQuickAddProps = {
	location: 'pantry' | 'fridge' | 'freezer'
}

type ActionData = {
	status: 'success' | 'merged' | 'error' | 'duplicate_warning'
	existingItem?: {
		id: string
		name: string
		location: string
		quantity: number | null
		unit: string | null
	}
	mergedInto?: string
	message?: string
}

export function InventoryQuickAdd({ location }: InventoryQuickAddProps) {
	const [name, setName] = useState('')
	const [showQty, setShowQty] = useState(false)
	const [quantity, setQuantity] = useState('')
	const [unit, setUnit] = useState('')
	const fetcher = useFetcher<ActionData>()
	const [lastWarningName, setLastWarningName] = useState('')
	const nameRef = useRef<HTMLInputElement>(null)

	const isDuplicateWarning =
		fetcher.data?.status === 'duplicate_warning' && name === lastWarningName

	const prevFetcherData = useRef(fetcher.data)

	// Track which name triggered the warning so editing dismisses it,
	// and reset form after success or merge
	useEffect(() => {
		if (fetcher.data === prevFetcherData.current) return
		prevFetcherData.current = fetcher.data

		if (fetcher.data?.status === 'duplicate_warning') {
			setLastWarningName(name)
		}

		if (
			fetcher.data?.status === 'success' ||
			fetcher.data?.status === 'merged'
		) {
			setName('')
			setQuantity('')
			setUnit('')
			setShowQty(false)
			setLastWarningName('')
			nameRef.current?.focus()
		}
	}, [fetcher.data, name])

	function handleForceSubmit(force: 'merge' | 'add') {
		const formData = new FormData()
		formData.set('intent', 'create')
		formData.set('location', location)
		formData.set('name', name)
		if (quantity) formData.set('quantity', quantity)
		if (unit) formData.set('unit', unit)
		formData.set('force', force)
		void fetcher.submit(formData, { method: 'POST' })
	}

	return (
		<div>
			<fetcher.Form
				method="POST"
				className="flex items-end gap-2 border-b border-border pb-2"
				onSubmit={(e) => {
					if (!name.trim()) {
						e.preventDefault()
						return
					}
				}}
			>
				<input type="hidden" name="intent" value="create" />
				<input type="hidden" name="location" value={location} />
				<div className="min-w-0 flex-1">
					<input
						ref={nameRef}
						name="name"
						placeholder="Add an item..."
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="h-9 w-full border-0 bg-transparent px-0 text-sm shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
					/>
					{showQty && (
						<div className="flex gap-2 pb-1">
							<input
								name="quantity"
								type="number"
								step="0.1"
								min="0"
								placeholder="Qty"
								value={quantity}
								onChange={(e) => setQuantity(e.target.value)}
								className="h-7 w-16 rounded border border-border/50 bg-transparent px-2 text-sm outline-none focus:border-primary/30"
							/>
							<input
								name="unit"
								placeholder="Unit"
								value={unit}
								onChange={(e) => setUnit(e.target.value)}
								className="h-7 w-20 rounded border border-border/50 bg-transparent px-2 text-sm outline-none focus:border-primary/30"
							/>
						</div>
					)}
					{!showQty && (
						<button
							type="button"
							onClick={() => setShowQty(true)}
							className="pb-1 text-xs text-muted-foreground hover:text-foreground"
						>
							+ Qty / Unit
						</button>
					)}
				</div>
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					className="size-8 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-muted"
					disabled={!name.trim() || fetcher.state !== 'idle'}
				>
					<Icon name="plus" size="sm" />
				</Button>
			</fetcher.Form>

			{isDuplicateWarning && fetcher.data?.existingItem && (
				<div className="mt-2 rounded-lg bg-accent/10 p-3">
					<p className="text-sm">
						You already have <strong>{fetcher.data.existingItem.name}</strong>{' '}
						in the {fetcher.data.existingItem.location}
						{fetcher.data.existingItem.quantity
							? ` (${fetcher.data.existingItem.quantity}${fetcher.data.existingItem.unit ? ` ${fetcher.data.existingItem.unit}` : ''})`
							: ''}
						.
					</p>
					<div className="mt-2 flex gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => handleForceSubmit('merge')}
						>
							Update existing
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => handleForceSubmit('add')}
						>
							Add anyway
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
