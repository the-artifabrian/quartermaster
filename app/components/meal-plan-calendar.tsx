import {
	MEAL_TYPES,
	formatDayLabel,
	isPast,
	isToday,
	serializeDate,
} from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { MealSlotCard } from './meal-slot-card.tsx'
import { type RecipeSelectorRecipe } from './recipe-selector.tsx'

type Entry = {
	id: string
	date: Date
	mealType: string
	servings: number | null
	cooked: boolean
	recipe: RecipeSelectorRecipe
}

type MealPlanCalendarProps = {
	weekDays: Date[]
	entries: Entry[]
	recipes: RecipeSelectorRecipe[]
	weekStart: string
}

/**
 * Reorder days for mobile: today first, then future days, then past days.
 * This keeps today always at the top so you don't have to scroll past
 * Mon–Thu to reach Friday.
 */
function mobileDayOrder(weekDays: Date[]): Date[] {
	const todayIdx = weekDays.findIndex(isToday)
	if (todayIdx === -1) return weekDays // not current week, keep chronological
	return [
		...weekDays.slice(todayIdx), // today → end of week
		...weekDays.slice(0, todayIdx), // start of week → yesterday
	]
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

	function getEntriesForDay(date: Date) {
		const dateStr = serializeDate(date)
		let count = 0
		for (const mealType of MEAL_TYPES) {
			const slotEntries = entryMap.get(`${dateStr}-${mealType}`)
			if (slotEntries) count += slotEntries.length
		}
		return count
	}

	const mobileDays = mobileDayOrder(weekDays)

	return (
		<>
			{/* Desktop: 7-col grid at lg, 4-col at md */}
			<div className="hidden gap-2 md:grid md:grid-cols-4 lg:grid-cols-7">
				{weekDays.map((date) => {
					const today = isToday(date)
					const past = isPast(date)
					return (
						<div
							key={serializeDate(date)}
							className={cn(
								'bg-card rounded-xl p-3 shadow-warm transition-shadow',
								today && 'border-accent border-t-2',
								!today && 'hover:shadow-warm-md hover:border-accent/20 border border-transparent',
								past && !today && 'opacity-80',
							)}
						>
							<div className="mb-2 text-center">
								<span
									className={cn(
										'font-serif text-sm',
										today
											? 'text-accent font-semibold'
											: 'text-muted-foreground',
									)}
								>
									{formatDayLabel(date)}
								</span>
							</div>
							<div className="space-y-1.5">
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
					)
				})}
			</div>

			{/* Mobile: vertical day stack, today first */}
			<div className="space-y-3 md:hidden">
				{mobileDays.map((date) => {
					const dayCount = getEntriesForDay(date)
					const today = isToday(date)
					const past = isPast(date)
					return (
						<div
							key={serializeDate(date)}
							className={cn(
								'rounded-xl',
								today && 'bg-accent/5 p-3',
								past && !today && 'opacity-80',
							)}
						>
							<div className="mb-1.5 flex items-baseline justify-between">
								<span
									className={cn(
										'font-serif font-semibold',
										today
											? 'border-accent text-accent border-b-2 text-base'
											: 'text-sm',
									)}
								>
									{formatDayLabel(date)}
								</span>
								<span className="text-muted-foreground text-xs">
									{dayCount > 0
										? `${dayCount} meal${dayCount !== 1 ? 's' : ''}`
										: 'Nothing planned'}
								</span>
							</div>
							<div className="space-y-1.5">
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
					)
				})}
			</div>
		</>
	)
}
