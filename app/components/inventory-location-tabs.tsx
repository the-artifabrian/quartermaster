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
		<div className="bg-muted inline-flex gap-1 overflow-x-auto rounded-full p-1">
			{locations.map((location) => (
				<Link
					key={location.value}
					to={
						location.value === 'all'
							? '/inventory'
							: `?location=${location.value}`
					}
					className={cn(
						'rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200',
						currentLocation === location.value
							? 'bg-primary text-primary-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					{location.label}
				</Link>
			))}
		</div>
	)
}
