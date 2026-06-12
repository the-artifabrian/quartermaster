import { useState } from 'react'
import {
	MEAL_TYPES,
	formatDayLabel,
	formatMonthDay,
	formatWeekdayName,
	isPast,
	isToday,
	serializeDate,
} from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { MealSlotCard } from './meal-slot-card.tsx'
import { type RecipeSelectorRecipe } from './recipe-selector.tsx'
import { Icon } from './ui/icon.tsx'

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
}: {
	date: Date
	entryMap: Map<string, Entry[]>
	recipes: RecipeSelectorRecipe[]
}) {
	const [expanded, setExpanded] = useState(false)

	if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => setExpanded(true)}
				className="text-muted-foreground hover:text-foreground flex min-h-9 w-full items-center gap-1.5 rounded-md py-1.5 text-[13px] transition-colors"
			>
				<Icon name="plus" className="size-3.5" />
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
	// Index in mobileDays where the demoted past days begin (C1): today-first
	// reordering moves Mon…yesterday to the end, and a small-caps seam marks
	// where the week wraps so the shape stays scannable.
	const todayIdx = weekDays.findIndex(isToday)
	const earlierStartIdx = todayIdx > 0 ? mobileDays.length - todayIdx : -1

	return (
		<>
			{/* Desktop: 4+3 two-row layout */}
			<div className="hidden flex-wrap gap-2 md:flex">
				{weekDays.map((date) => {
					const today = isToday(date)
					return (
						<div
							key={serializeDate(date)}
							className={cn(
								'border-t-[3px] p-2.5',
								'basis-[calc(25%-6px)]',
								today ? 'border-accent' : 'border-border/40',
							)}
						>
							<div className="mb-2 text-center">
								{/* The copper top-border marks today; the day name stays ink
								    (copper text at this size fails AA in light mode) */}
								<span
									className={cn(
										'font-serif text-sm',
										today ? 'text-foreground' : 'text-muted-foreground',
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
										/>
									)
								})}
							</div>
						</div>
					)
				})}
			</div>

			{/* Mobile: vertical day stack, today first */}
			<div className="divide-border/40 divide-y md:hidden">
				{mobileDays.map((date, i) => {
					const dayCount = getEntriesForDay(date)
					const today = isToday(date)
					return (
						<div
							key={serializeDate(date)}
							className="py-4 first:pt-0 last:pb-0"
						>
							{i === earlierStartIdx && (
								<p className="text-muted-foreground/70 mb-3 text-[11px] font-semibold tracking-wider uppercase">
									Earlier this week
								</p>
							)}
							<div className="mb-2 flex items-baseline justify-between">
								<span className="flex items-baseline gap-2">
									{/* Copper dot marks "now"; the day name stays ink */}
									{today && (
										<span
											aria-hidden="true"
											className="bg-accent size-1.5 shrink-0 self-center rounded-full"
										/>
									)}
									<span
										className={cn(
											'font-serif text-lg leading-none',
											!today && isPast(date) && 'text-muted-foreground/70',
										)}
									>
										{today ? 'Today' : formatWeekdayName(date)}
									</span>
									<span className="text-muted-foreground text-xs">
										{formatMonthDay(date)}
									</span>
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
											/>
										)
									})}
								</div>
							) : (
								<CollapsibleDaySlots
									date={date}
									entryMap={entryMap}
									recipes={recipes}
								/>
							)}
						</div>
					)
				})}
			</div>
		</>
	)
}
