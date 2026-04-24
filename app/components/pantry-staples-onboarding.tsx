import { useEffect, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { RECOMMENDED_STAPLES } from '#app/utils/pantry-staples.ts'
import { Button } from './ui/button.tsx'
import { Checkbox } from './ui/checkbox.tsx'
import { Icon } from './ui/icon.tsx'

type CheckedState = Record<string, boolean>

function getInitialState(): CheckedState {
	const state: CheckedState = {}
	for (const item of RECOMMENDED_STAPLES) {
		state[item.name] = item.checked
	}
	return state
}

export function PantryStaplesOnboarding({
	maxItems,
	onSuccess,
	onDismiss,
}: {
	maxItems?: number
	onSuccess?: () => void
	onDismiss?: () => void
}) {
	const [checked, setChecked] = useState<CheckedState>(getInitialState)
	const [done, setDone] = useState(false)
	const fetcher = useFetcher<{ status: string; createdCount?: number }>()
	const isSubmitting = fetcher.state !== 'idle'

	useEffect(() => {
		if (fetcher.data?.status === 'success') {
			setDone(true)
			onSuccess?.()
		}
	}, [fetcher.data, onSuccess])

	function handleToggle(name: string) {
		setChecked((prev) => ({
			...prev,
			[name]: !prev[name],
		}))
	}

	function handleSelectAll() {
		setChecked(
			Object.fromEntries(RECOMMENDED_STAPLES.map((item) => [item.name, true])),
		)
	}

	function handleDeselectAll() {
		setChecked(
			Object.fromEntries(RECOMMENDED_STAPLES.map((item) => [item.name, false])),
		)
	}

	function getSelectedItems() {
		return Object.entries(checked)
			.filter(([, isChecked]) => isChecked)
			.map(([name]) => ({ name }))
	}

	const selectedItems = getSelectedItems()
	const totalSelected = selectedItems.length
	const overLimit = maxItems !== undefined && totalSelected > maxItems
	const allSelected = totalSelected === RECOMMENDED_STAPLES.length

	function handleSubmit() {
		if (totalSelected === 0) return
		const itemsToSubmit =
			maxItems !== undefined ? selectedItems.slice(0, maxItems) : selectedItems
		const formData = new FormData()
		formData.set('intent', 'bulk-create')
		formData.set('items', JSON.stringify(itemsToSubmit))
		void fetcher.submit(formData, { method: 'POST' })
	}

	if (done) {
		const count = fetcher.data?.createdCount ?? totalSelected
		return (
			<div className="bg-card shadow-warm mx-auto max-w-2xl rounded-2xl border px-4 py-6 sm:px-6 sm:py-8">
				<div className="text-center">
					<Icon name="check" className="text-primary mx-auto size-12" />
					<h2 className="mt-4 font-serif text-2xl font-normal">
						Pantry started
					</h2>
					<p className="text-muted-foreground mt-2">
						{count} item{count !== 1 ? 's' : ''} marked as usually on hand.
					</p>
					<div className="mt-6 flex flex-col items-center gap-3">
						<Button asChild>
							<Link to="/recipes">Browse Recipes</Link>
						</Button>
						<button
							type="button"
							onClick={onDismiss}
							className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
						>
							View Pantry
						</button>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="bg-card shadow-warm mx-auto max-w-2xl rounded-2xl border px-4 py-6 sm:px-6 sm:py-8">
			<div className="mb-6 text-center sm:mb-8">
				<Icon name="home" className="text-muted-foreground mx-auto size-12" />
				<h2 className="mt-4 font-serif text-2xl font-normal">
					Start your Pantry
				</h2>
				<p className="text-muted-foreground mt-2">
					Select ingredients you usually keep around. You can always add more
					later.
				</p>
			</div>

			<div className="bg-secondary/30 rounded-xl border p-3 sm:p-5">
				<div className="mb-3 flex items-center justify-between">
					<h3 className="text-lg font-semibold">Usually on hand</h3>
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground text-sm"
						onClick={() =>
							allSelected ? handleDeselectAll() : handleSelectAll()
						}
					>
						{allSelected ? 'Deselect all' : 'Select all'}
					</button>
				</div>
				<div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
					{RECOMMENDED_STAPLES.map((item) => (
						<label
							key={item.name}
							className="bg-background flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 select-none sm:gap-2.5 sm:px-3 sm:py-2.5"
						>
							<Checkbox
								checked={checked[item.name] ?? false}
								onCheckedChange={() => handleToggle(item.name)}
								className="shrink-0"
							/>
							<span className="text-xs leading-tight capitalize sm:text-sm">
								{item.name}
							</span>
						</label>
					))}
				</div>
			</div>

			<div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div>
					<p className="text-muted-foreground text-sm">
						{totalSelected} item{totalSelected !== 1 ? 's' : ''} selected
						{maxItems !== undefined && ` (max ${maxItems} on free plan)`}
					</p>
					{overLimit && (
						<p className="text-accent text-sm">
							Only the first {maxItems} items will be added.{' '}
							<a
								href="/upgrade"
								className="font-medium underline underline-offset-2"
							>
								Upgrade for unlimited Pantry items
							</a>
						</p>
					)}
				</div>
				<div className="flex gap-3">
					<Button variant="ghost" asChild>
						<a href="/inventory/new">Skip, add manually</a>
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={totalSelected === 0 || isSubmitting}
					>
						{isSubmitting ? (
							'Saving...'
						) : (
							<>
								<Icon name="plus" size="sm" />
								Save selected
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}
