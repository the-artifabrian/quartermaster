import { type Recipe } from '@prisma/client'
import { useEffect, useRef } from 'react'
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
	const todayRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to today's card on mobile
	useEffect(() => {
		todayRef.current?.scrollIntoView({
			behavior: 'smooth',
			inline: 'center',
			block: 'nearest',
		})
	}, [])

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

	const weekdayRow = weekDays.slice(0, 4) // Mon–Thu
	const weekendRow = weekDays.slice(4) // Fri–Sun

	return (
		<>
			{/* Desktop: two rows — Mon–Thu (4 cols), Fri–Sun (3 cols) */}
			<div className="hidden md:block space-y-4">
				{[weekdayRow, weekendRow].map((rowDays, rowIdx) => (
					<div key={rowIdx} className="grid grid-cols-4 gap-1">
						{rowDays.map((date) => (
							<div key={serializeDate(date)}>
								<div className="pb-2 text-center">
									<span
										className={cn(
											'inline-block text-sm font-medium',
											isToday(date)
												? 'bg-accent text-accent-foreground rounded-full px-3 py-0.5 text-xs font-semibold'
												: 'text-muted-foreground',
										)}
									>
										{formatDayLabel(date)}
									</span>
								</div>
								<div
									className={cn(
										'space-y-2 rounded-xl p-1.5',
										isToday(date) && 'bg-accent/5',
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
							</div>
						))}
					</div>
				))}
			</div>

			{/* Mobile: horizontal snap-scroll, one day per card */}
			<div className="md:hidden">
				<div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
					{weekDays.map((date) => {
						const dayCount = getEntriesForDay(date)
						const today = isToday(date)
						return (
							<div
								key={serializeDate(date)}
								ref={today ? todayRef : undefined}
								className={cn(
									'w-[85vw] flex-shrink-0 snap-start rounded-xl',
									today && 'border-t-2 border-accent',
								)}
							>
								<div className="mb-2">
									<p
										className={cn(
											'text-sm font-medium',
											today &&
												'text-primary bg-accent/10 rounded-full px-3 py-1 inline-block',
										)}
									>
										{formatDayLabel(date)}
									</p>
									<p className="text-muted-foreground mt-0.5 text-xs">
										{dayCount > 0
											? `${dayCount} meal${dayCount !== 1 ? 's' : ''} planned`
											: 'Nothing planned yet'}
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
						)
					})}
				</div>
			</div>
		</>
	)
}
