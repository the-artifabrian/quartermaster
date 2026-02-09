import { type Recipe } from '@prisma/client'
import {
	MEAL_TYPES,
	formatDayLabel,
	isToday,
	serializeDate,
} from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { MealSlotCard } from './meal-slot-card.tsx'

type Entry = {
	id: string
	date: Date
	mealType: string
	servings: number | null
	cooked: boolean
	recipe: Recipe
}

type MealPlanCalendarProps = {
	weekDays: Date[]
	entries: Entry[]
	recipes: Recipe[]
	weekStart: string
}

export function MealPlanCalendar({
	weekDays,
	entries,
	recipes,
	weekStart,
}: MealPlanCalendarProps) {
	// Group entries by date and mealType (multiple entries per slot)
	const entryMap = new Map<string, Entry[]>()
	for (const entry of entries) {
		const key = `${serializeDate(entry.date)}-${entry.mealType}`
		const existing = entryMap.get(key) || []
		existing.push(entry)
		entryMap.set(key, existing)
	}

	return (
		<>
			{/* Desktop: day-column grid */}
			<div className="hidden md:block">
				<div className="grid grid-cols-7 gap-3">
					{/* Header row */}
					{weekDays.map((date) => (
						<div
							key={`header-${serializeDate(date)}`}
							className={cn(
								'pb-2 text-center text-sm font-medium',
								isToday(date) ? 'text-primary' : 'text-muted-foreground',
							)}
						>
							{formatDayLabel(date)}
						</div>
					))}
					{/* Day columns with stacked meal types */}
					{weekDays.map((date) => (
						<div
							key={`day-${serializeDate(date)}`}
							className={cn(
								'space-y-2 rounded-lg p-1.5',
								isToday(date) && 'bg-primary/5',
							)}
						>
							{MEAL_TYPES.map((mealType) => {
								const key = `${serializeDate(date)}-${mealType}`
								const slotEntries = entryMap.get(key) || []
								return (
									<MealSlotCard
										key={mealType}
										date={date}
										mealType={mealType}
										entries={slotEntries}
										recipes={recipes}
										weekStart={weekStart}
									/>
								)
							})}
						</div>
					))}
				</div>
			</div>

			{/* Mobile: horizontal snap-scroll, one day per card */}
			<div className="md:hidden">
				<div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
					{weekDays.map((date) => (
						<div
							key={serializeDate(date)}
							className="w-[85vw] flex-shrink-0 snap-start"
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
							<div className="space-y-2">
								{MEAL_TYPES.map((mealType) => {
									const key = `${serializeDate(date)}-${mealType}`
									const slotEntries = entryMap.get(key) || []
									return (
										<MealSlotCard
											key={mealType}
											date={date}
											mealType={mealType}
											entries={slotEntries}
											recipes={recipes}
											weekStart={weekStart}
										/>
									)
								})}
							</div>
						</div>
					))}
				</div>
			</div>
		</>
	)
}
