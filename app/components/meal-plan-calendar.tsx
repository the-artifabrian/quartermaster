import { useState } from 'react'
import { useFetcher } from 'react-router'
import {
	MEAL_TYPES,
	MEAL_TYPE_LABELS,
	type MealType,
	formatDayLabel,
	formatMonthDay,
	formatWeekdayName,
	isPast,
	isToday,
	serializeDate,
} from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { type PlanMeal, MealCard } from './meal-card.tsx'
import {
	type RecipeSelectorRecipe,
	RecipeSelector,
} from './recipe-selector.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

type MealPlanCalendarProps = {
	weekDays: Date[]
	meals: PlanMeal[]
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
 * The add affordance under each day: one quiet row that expands into the
 * Recipe picker — the same two taps as the old empty slot — with optional
 * label chips and a text-Meal mode for plans like "Leftovers".
 */
function AddMealRow({
	date,
	recipes,
}: {
	date: Date
	recipes: RecipeSelectorRecipe[]
}) {
	const fetcher = useFetcher()
	const [open, setOpen] = useState(false)
	const [mode, setMode] = useState<'recipe' | 'text'>('recipe')
	const [label, setLabel] = useState<MealType | null>(null)
	const [text, setText] = useState('')

	function close() {
		setOpen(false)
		setMode('recipe')
		setLabel(null)
		setText('')
	}

	function submitRecipe(recipe: RecipeSelectorRecipe) {
		void fetcher.submit(
			{
				intent: 'addMeal',
				date: serializeDate(date),
				recipeId: recipe.id,
				...(label ? { label } : {}),
			},
			{ method: 'POST' },
		)
		close()
	}

	function submitText() {
		if (!text.trim()) return
		void fetcher.submit(
			{
				intent: 'addTextMeal',
				date: serializeDate(date),
				text: text.trim(),
				...(label ? { label } : {}),
			},
			{ method: 'POST' },
		)
		close()
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="text-muted-foreground hover:text-foreground flex min-h-9 w-full items-center gap-1.5 rounded-md py-1.5 text-[13px] transition-colors"
			>
				<Icon name="plus" className="size-3.5" />
				Add meal
			</button>
		)
	}

	return (
		<div className="relative">
			{/* In flow on phones (an overlay would cover the next day's cards);
			    floated on desktop so the 4+3 day grid doesn't reflow while open. */}
			<div className="bg-card animate-fade-up-reveal shadow-warm-lg rounded-lg border p-3 md:absolute md:top-0 md:right-0 md:left-0 md:z-20 md:min-w-[280px]">
				{/* Optional familiar label — a Meal without one stays unlabeled (#98) */}
				<div className="mb-2 flex flex-wrap gap-1">
					{MEAL_TYPES.map((type) => (
						<button
							key={type}
							type="button"
							onClick={() => setLabel(label === type ? null : type)}
							aria-pressed={label === type}
							className={cn(
								'rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
								label === type
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border text-muted-foreground hover:text-foreground',
							)}
						>
							{MEAL_TYPE_LABELS[type]}
						</button>
					))}
				</div>

				{mode === 'recipe' ? (
					<>
						<RecipeSelector
							recipes={recipes}
							date={date}
							onCancel={close}
							onPick={submitRecipe}
						/>
						<button
							type="button"
							onClick={() => setMode('text')}
							className="text-muted-foreground hover:text-foreground mt-2 text-xs underline-offset-2 hover:underline"
						>
							Add text instead (e.g. Leftovers)
						</button>
					</>
				) : (
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<Input
								autoFocus
								value={text}
								onChange={(e) => setText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') submitText()
									if (e.key === 'Escape') close()
								}}
								placeholder="Leftovers, takeout, dinner out..."
								maxLength={200}
								aria-label="Meal text"
							/>
							<Button
								variant="ghost"
								size="icon"
								onClick={close}
								aria-label="Close add meal"
							>
								<Icon name="cross-1" size="sm" />
							</Button>
						</div>
						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={() => setMode('recipe')}
								className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
							>
								Pick a recipe instead
							</button>
							<Button size="sm" onClick={submitText} disabled={!text.trim()}>
								Add
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

/** One day: its compact ordered Meal list plus the add row. */
function DayMeals({
	date,
	meals,
	recipes,
}: {
	date: Date
	meals: PlanMeal[]
	recipes: RecipeSelectorRecipe[]
}) {
	return (
		<div className="space-y-1.5">
			{meals.map((meal, index) => (
				<MealCard
					key={meal.id}
					meal={meal}
					recipes={recipes}
					canMoveUp={index > 0}
					canMoveDown={index < meals.length - 1}
				/>
			))}
			<AddMealRow date={date} recipes={recipes} />
		</div>
	)
}

export function MealPlanCalendar({
	weekDays,
	meals,
	recipes,
}: MealPlanCalendarProps) {
	// Meals arrive ordered (date, order); group them per day. Days render only
	// actual Meals — no permanent empty slots (#105).
	const mealsByDay = new Map<string, PlanMeal[]>()
	for (const meal of meals) {
		const existing = mealsByDay.get(meal.dateStr) || []
		existing.push(meal)
		mealsByDay.set(meal.dateStr, existing)
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
					const dayMeals = mealsByDay.get(serializeDate(date)) || []
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
							<DayMeals date={date} meals={dayMeals} recipes={recipes} />
						</div>
					)
				})}
			</div>

			{/* Mobile: vertical day stack, today first */}
			<div className="divide-border/40 divide-y md:hidden">
				{mobileDays.map((date, i) => {
					const dayMeals = mealsByDay.get(serializeDate(date)) || []
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
								{dayMeals.length > 0 && (
									<span className="text-muted-foreground text-xs">
										{dayMeals.length} meal{dayMeals.length !== 1 ? 's' : ''}
									</span>
								)}
							</div>
							<DayMeals date={date} meals={dayMeals} recipes={recipes} />
						</div>
					)
				})}
			</div>
		</>
	)
}
