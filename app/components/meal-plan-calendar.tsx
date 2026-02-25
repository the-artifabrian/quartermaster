import { useState } from 'react'
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
	isProActive?: boolean
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

/**
 * On mobile, empty days collapse to a single "Add a meal" button.
 * Tapping expands to show all 4 meal type slots.
 */
function CollapsibleDaySlots({
	date,
	entryMap,
	recipes,
	weekStart,
	isProActive,
}: {
	date: Date
	entryMap: Map<string, Entry[]>
	recipes: RecipeSelectorRecipe[]
	weekStart: string
	isProActive?: boolean
}) {
	const [expanded, setExpanded] = useState(false)

	if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => setExpanded(true)}
				className="text-muted-foreground hover:text-foreground hover:bg-muted/40 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors"
			>
				<span className="bg-muted flex size-5 items-center justify-center rounded-full text-[10px]">
					+
				</span>
				Add a meal
			</button>
		)
	}

	return (
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
						isProActive={isProActive}
					/>
				)
			})}
		</div>
	)
}

export function MealPlanCalendar({
	weekDays,
	entries,
	recipes,
	weekStart,
	isProActive,
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
			{/* Desktop: 4+3 two-row layout */}
			<div className="hidden flex-wrap gap-2 md:flex">
				{weekDays.map((date) => {
					const today = isToday(date)
					const past = isPast(date)
					return (
						<div
							key={serializeDate(date)}
							className={cn(
								'bg-card rounded-xl p-4 shadow-warm transition-shadow',
								'basis-[calc(25%-6px)]',
								today && 'border-accent border-t-[3px] ring-2 ring-accent/30',
								!today && 'hover:shadow-warm-md hover:border-accent/20 border border-transparent',
								past && !today && 'opacity-80',
							)}
						>
							<div className="mb-2 text-center">
								<span
									className={cn(
										'font-serif text-sm',
										today
											? 'bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs font-semibold'
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
											isProActive={isProActive}
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
								today && 'bg-accent/10 p-3 ring-1 ring-accent/20',
								past && !today && 'opacity-80',
							)}
						>
							<div className="mb-1.5 flex items-baseline justify-between">
								<span
									className={cn(
										'font-serif',
										today
											? 'bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-sm'
											: 'text-sm',
									)}
								>
									{formatDayLabel(date)}
								</span>
								{dayCount > 0 && (
									<span className="text-muted-foreground text-xs">
										{dayCount} meal{dayCount !== 1 ? 's' : ''}
									</span>
								)}
							</div>
							{dayCount > 0 ? (
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
												isProActive={isProActive}
											/>
										)
									})}
								</div>
							) : (
								<CollapsibleDaySlots
									date={date}
									entryMap={entryMap}
									recipes={recipes}
									weekStart={weekStart}
									isProActive={isProActive}
								/>
							)}
						</div>
					)
				})}
			</div>
		</>
	)
}
