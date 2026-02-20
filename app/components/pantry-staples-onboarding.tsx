import { useState } from 'react'
import { useFetcher } from 'react-router'
import { RECOMMENDED_STAPLES } from '#app/utils/pantry-staples.ts'
import { Button } from './ui/button.tsx'
import { Checkbox } from './ui/checkbox.tsx'
import { Icon } from './ui/icon.tsx'

const SECTION_CONFIG = {
	pantry: { title: 'Pantry Essentials', icon: 'home' },
	fridge: { title: 'Fridge Basics', icon: 'cookie' },
	freezer: { title: 'Freezer Staples', icon: 'cookie' },
} as const

type CheckedState = Record<string, Record<string, boolean>>

function getInitialState(): CheckedState {
	const state: CheckedState = {}
	for (const [location, items] of Object.entries(RECOMMENDED_STAPLES)) {
		state[location] = {}
		for (const item of items) {
			state[location][item.name] = item.checked
		}
	}
	return state
}

export function PantryStaplesOnboarding({ maxItems }: { maxItems?: number }) {
	const [checked, setChecked] = useState<CheckedState>(getInitialState)
	const fetcher = useFetcher()
	const isSubmitting = fetcher.state !== 'idle'

	function handleToggle(location: string, name: string) {
		setChecked((prev) => ({
			...prev,
			[location]: {
				...prev[location],
				[name]: !prev[location]?.[name],
			},
		}))
	}

	function handleSelectAll(location: string) {
		setChecked((prev) => ({
			...prev,
			[location]: Object.fromEntries(
				RECOMMENDED_STAPLES[location as keyof typeof RECOMMENDED_STAPLES].map(
					(item) => [item.name, true],
				),
			),
		}))
	}

	function handleDeselectAll(location: string) {
		setChecked((prev) => ({
			...prev,
			[location]: Object.fromEntries(
				RECOMMENDED_STAPLES[location as keyof typeof RECOMMENDED_STAPLES].map(
					(item) => [item.name, false],
				),
			),
		}))
	}

	function getSelectedItems() {
		const items: Array<{ name: string; location: string }> = []
		for (const [location, itemStates] of Object.entries(checked)) {
			for (const [name, isChecked] of Object.entries(itemStates)) {
				if (isChecked) {
					items.push({ name, location })
				}
			}
		}
		return items
	}

	const selectedItems = getSelectedItems()
	const totalSelected = selectedItems.length
	const overLimit = maxItems !== undefined && totalSelected > maxItems

	function handleSubmit() {
		if (totalSelected === 0) return
		const itemsToSubmit =
			maxItems !== undefined ? selectedItems.slice(0, maxItems) : selectedItems
		const formData = new FormData()
		formData.set('intent', 'bulk-create')
		formData.set('items', JSON.stringify(itemsToSubmit))
		void fetcher.submit(formData, { method: 'POST' })
	}

	return (
		<div className="bg-card shadow-warm mx-auto max-w-2xl rounded-2xl border px-6 py-8">
			<div className="mb-8 text-center">
				<Icon name="home" className="text-muted-foreground mx-auto size-12" />
				<h2 className="mt-4 font-serif text-2xl font-normal">Stock Your Kitchen</h2>
				<p className="text-muted-foreground mt-2">
					Select the staples you already have on hand. You can always add more
					later.
				</p>
			</div>

			<div className="space-y-6">
				{(
					Object.entries(RECOMMENDED_STAPLES) as Array<
						[
							keyof typeof RECOMMENDED_STAPLES,
							(typeof RECOMMENDED_STAPLES)[keyof typeof RECOMMENDED_STAPLES],
						]
					>
				).map(([location, items]) => {
					const config = SECTION_CONFIG[location]
					const locationChecked = checked[location] ?? {}
					const checkedCount =
						Object.values(locationChecked).filter(Boolean).length
					const allSelected = checkedCount === items.length
					return (
						<div key={location} className="bg-secondary/30 rounded-xl border p-5">
							<div className="mb-3 flex items-center justify-between">
								<h3 className="flex items-center gap-2 text-lg font-semibold">
									<Icon name={config.icon} className="size-5" />
									{config.title}
								</h3>
								<button
									type="button"
									className="text-muted-foreground hover:text-foreground text-sm"
									onClick={() =>
										allSelected
											? handleDeselectAll(location)
											: handleSelectAll(location)
									}
								>
									{allSelected ? 'Deselect all' : 'Select all'}
								</button>
							</div>
							<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
								{items.map((item) => (
									<label
										key={item.name}
										className="bg-background flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 select-none"
									>
										<Checkbox
											checked={locationChecked[item.name] ?? false}
											onCheckedChange={() => handleToggle(location, item.name)}
										/>
										<span className="text-sm capitalize">{item.name}</span>
									</label>
								))}
							</div>
						</div>
					)
				})}
			</div>

			<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div>
					<p className="text-muted-foreground text-sm">
						{totalSelected} item{totalSelected !== 1 ? 's' : ''} selected
						{maxItems !== undefined && ` (max ${maxItems} on free plan)`}
					</p>
					{overLimit && (
						<p className="text-sm text-accent">
							Only the first {maxItems} items will be added.{' '}
							<a
								href="/upgrade"
								className="font-medium underline underline-offset-2"
							>
								Upgrade for unlimited
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
							'Adding...'
						) : (
							<>
								<Icon name="plus" size="sm" />
								Add Selected Items
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}
