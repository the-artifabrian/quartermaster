import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'

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
	const [isOpen, setIsOpen] = useState(false)
	const [name, setName] = useState('')
	const [quantity, setQuantity] = useState('')
	const [unit, setUnit] = useState('')
	const fetcher = useFetcher<ActionData>()
	const [lastWarningName, setLastWarningName] = useState('')

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
			setIsOpen(false)
			setLastWarningName('')
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

	if (!isOpen) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => setIsOpen(true)}
				className="w-full"
			>
				<Icon name="plus" size="sm" />
				Quick Add
			</Button>
		)
	}

	return (
		<div className="space-y-2">
			<fetcher.Form
				method="POST"
				className="flex flex-wrap gap-2"
				onSubmit={(e) => {
					if (!name.trim()) {
						e.preventDefault()
						return
					}
				}}
			>
				<input type="hidden" name="intent" value="create" />
				<input type="hidden" name="location" value={location} />
				<Input
					name="name"
					placeholder="Item name..."
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
					className="min-w-[120px] flex-1"
				/>
				<Input
					name="quantity"
					type="number"
					step="0.1"
					min="0"
					placeholder="Qty"
					value={quantity}
					onChange={(e) => setQuantity(e.target.value)}
					className="w-20 min-w-0 shrink"
				/>
				<Input
					name="unit"
					placeholder="Unit"
					value={unit}
					onChange={(e) => setUnit(e.target.value)}
					className="w-24 min-w-0 shrink"
				/>
				<StatusButton
					type="submit"
					size="sm"
					status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
					disabled={!name.trim()}
				>
					Add
				</StatusButton>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label="Close quick add"
					onClick={() => {
						setIsOpen(false)
						setName('')
						setQuantity('')
						setUnit('')
					}}
				>
					<Icon name="cross-1" size="sm" />
				</Button>
			</fetcher.Form>

			{isDuplicateWarning && fetcher.data?.existingItem && (
				<div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-950/40">
					<p className="text-sm text-amber-800 dark:text-amber-300">
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
							className="border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
							onClick={() => handleForceSubmit('merge')}
						>
							Update existing
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="text-amber-700 dark:text-amber-400"
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
