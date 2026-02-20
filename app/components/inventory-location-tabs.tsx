import { Link, useSearchParams } from 'react-router'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'

export function InventoryLocationTabs() {
	const [searchParams] = useSearchParams()
	const currentLocation = searchParams.get('location') || 'all'

	const locations = [
		{ value: 'all', label: 'All' },
		{ value: 'pantry', label: LOCATION_LABELS.pantry },
		{ value: 'fridge', label: LOCATION_LABELS.fridge },
		{ value: 'freezer', label: LOCATION_LABELS.freezer },
	] as const

	return (
		<div className="flex gap-1.5 overflow-x-auto">
			{locations.map((location) => (
				<Link
					key={location.value}
					to={
						location.value === 'all'
							? '/inventory'
							: `?location=${location.value}`
					}
					className={cn(
						'flex h-9 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
						currentLocation === location.value
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border/50 bg-secondary/50 text-muted-foreground hover:bg-secondary',
					)}
				>
					{location.label}
				</Link>
			))}
		</div>
	)
}
