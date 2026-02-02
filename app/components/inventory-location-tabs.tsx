import { Link, useSearchParams } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'

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
		<div className="flex gap-2 border-b overflow-x-auto">
			{locations.map((location) => (
				<Link
					key={location.value}
					to={location.value === 'all' ? '/inventory' : `?location=${location.value}`}
					className={cn(
						'px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
						currentLocation === location.value
							? 'border-primary text-primary'
							: 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted',
					)}
				>
					{location.label}
				</Link>
			))}
		</div>
	)
}
