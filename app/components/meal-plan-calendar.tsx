import { type Recipe } from '@prisma/client'
import { MEAL_TYPES, formatDayLabel, isToday } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { MealSlotCard } from './meal-slot-card.tsx'

type Entry = {
	id: string
	date: Date
	mealType: string
	recipe: Recipe
}

type MealPlanCalendarProps = {
	weekDays: Date[]
	entries: Entry[]
	recipes: Recipe[]
}

export function MealPlanCalendar({
	weekDays,
	entries,
	recipes,
}: MealPlanCalendarProps) {
	// Group entries by date and mealType (multiple entries per slot)
	const entryMap = new Map<string, Entry[]>()
	for (const entry of entries) {
		const key = `${entry.date.toISOString()}-${entry.mealType}`
		const existing = entryMap.get(key) || []
		existing.push(entry)
		entryMap.set(key, existing)
	}

	return (
		<div className="space-y-6">
			{MEAL_TYPES.map((mealType) => (
				<div key={mealType}>
					<div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-7 md:overflow-visible">
						{weekDays.map((date) => {
							const key = `${date.toISOString()}-${mealType}`
							const slotEntries = entryMap.get(key) || []

							return (
								<div
									key={date.toISOString()}
									className="w-[85vw] flex-shrink-0 snap-start md:w-auto"
								>
									<div className="mb-2">
										<p
											className={cn(
												'text-sm font-medium',
												isToday(date) && 'text-primary',
											)}
										>
											{formatDayLabel(date)}
										</p>
									</div>
									<MealSlotCard
										date={date}
										mealType={mealType}
										entries={slotEntries}
										recipes={recipes}
									/>
								</div>
							)
						})}
					</div>
				</div>
			))}
		</div>
	)
}
