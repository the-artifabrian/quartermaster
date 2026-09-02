import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import {
	MEAL_TYPES,
	MEAL_TYPE_LABELS,
	type MealType,
	formatMonthDay,
	formatWeekdayName,
	isPast,
	isToday,
	serializeDate,
} from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { type PlanMeal, MealCard } from './meal-card.tsx'
import {
	type PlanItemChoice,
	PlanItemSelector,
	type PlanSelectorMenu,
	type RecipeSelectorRecipe,
} from './recipe-selector.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

type MealPlanCalendarProps = {
	weekDays: Date[]
	meals: PlanMeal[]
	recipes: RecipeSelectorRecipe[]
	menus: PlanSelectorMenu[]
}

type AddMealPresentation = 'primary' | 'row' | 'empty-row'

function initialSelectedDate(weekDays: Date[], meals: PlanMeal[]): string {
	const today = weekDays.find(isToday)
	if (today) return serializeDate(today)
	return meals[0]?.dateStr ?? serializeDate(weekDays[0]!)
}

/**
 * One add flow with two launch points: a primary action in the focused mobile
 * day, and a quiet row inside each desktop agenda day.
 */
function AddMealControl({
	date,
	recipes,
	menus,
	presentation,
}: {
	date: Date
	recipes: RecipeSelectorRecipe[]
	menus: PlanSelectorMenu[]
	presentation: AddMealPresentation
}) {
	const fetcher = useFetcher()
	const [open, setOpen] = useState(false)
	const [mode, setMode] = useState<'item' | 'text'>('item')
	const [label, setLabel] = useState<MealType | null>(null)
	const [text, setText] = useState('')

	function close() {
		setOpen(false)
		setMode('item')
		setLabel(null)
		setText('')
	}

	function submitChoice(choice: PlanItemChoice) {
		void fetcher.submit(
			{
				intent: choice.kind === 'recipe' ? 'addMeal' : 'addMenu',
				date: serializeDate(date),
				...(choice.kind === 'recipe'
					? { recipeId: choice.recipe.id }
					: { menuId: choice.menu.id }),
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

	const dateLabel = `${formatWeekdayName(date)}, ${formatMonthDay(date)}`
	const fields = (
		<>
			<fieldset className="mb-3">
				<legend className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
					Meal type <span className="font-normal normal-case">(optional)</span>
				</legend>
				<div className="flex flex-wrap gap-1">
					{MEAL_TYPES.map((type) => (
						<button
							key={type}
							type="button"
							onClick={() => setLabel(label === type ? null : type)}
							aria-pressed={label === type}
							className={cn(
								'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
								label === type
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border text-muted-foreground hover:text-foreground',
							)}
						>
							{MEAL_TYPE_LABELS[type]}
						</button>
					))}
				</div>
			</fieldset>

			{mode === 'item' ? (
				<>
					<PlanItemSelector
						recipes={recipes}
						menus={menus}
						date={date}
						onCancel={close}
						onPick={submitChoice}
					/>
					<button
						type="button"
						onClick={() => setMode('text')}
						className="text-muted-foreground hover:text-foreground mt-3 text-xs underline-offset-2 hover:underline"
					>
						Add text instead (for example, Leftovers)
					</button>
				</>
			) : (
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<Input
							autoFocus
							value={text}
							onChange={(event) => setText(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') submitText()
								if (event.key === 'Escape') close()
							}}
							placeholder="Leftovers, takeout, dinner out..."
							maxLength={200}
							aria-label="Meal text"
						/>
						<Button
							variant="ghost"
							size="icon"
							onClick={close}
							aria-label="Close add Meal"
						>
							<Icon name="cross-1" size="sm" />
						</Button>
					</div>
					<div className="flex items-center justify-between gap-3">
						<button
							type="button"
							onClick={() => setMode('item')}
							className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
						>
							Pick a Recipe or Menu instead
						</button>
						<Button size="sm" onClick={submitText} disabled={!text.trim()}>
							Add
						</Button>
					</div>
				</div>
			)}
		</>
	)

	if (presentation === 'primary') {
		if (!open) {
			return (
				<Button
					type="button"
					onClick={() => setOpen(true)}
					aria-label={`Add Meal to ${dateLabel}`}
				>
					<Icon name="plus" size="sm" />
					Add Meal
				</Button>
			)
		}

		return (
			<section
				aria-label={`Add Meal for ${dateLabel}`}
				className="border-border bg-muted/40 animate-fade-up-reveal w-full basis-full rounded-lg border p-3 sm:p-4"
			>
				<div className="mb-3">
					<p className="text-primary text-xs font-semibold tracking-wider uppercase">
						Add a Meal
					</p>
					<p className="text-muted-foreground mt-0.5 text-xs">
						{formatWeekdayName(date)} · {formatMonthDay(date)}
					</p>
				</div>
				{fields}
			</section>
		)
	}

	if (presentation === 'empty-row' && !open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={`Add Meal to ${dateLabel}`}
				className="group flex min-h-12 w-full items-center gap-3 text-left text-sm transition-colors"
			>
				<span className="text-muted-foreground group-hover:text-foreground">
					Nothing planned
				</span>
				<span className="text-primary group-hover:text-primary/75 inline-flex items-center gap-1 text-xs font-semibold">
					<Icon name="plus" className="size-3" />
					Add Meal
				</span>
			</button>
		)
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={`Add Meal to ${dateLabel}`}
				className="text-primary hover:text-primary/75 flex min-h-9 items-center gap-1 text-xs font-semibold transition-colors"
			>
				<Icon name="plus" className="size-3" />
				Add Meal
			</button>
		)
	}

	return (
		<section
			aria-label={`Add Meal for ${dateLabel}`}
			className="border-border bg-muted/40 animate-fade-up-reveal my-2 rounded-lg border p-3"
		>
			{fields}
		</section>
	)
}

function MealCards({
	meals,
	recipes,
}: {
	meals: PlanMeal[]
	recipes: RecipeSelectorRecipe[]
}) {
	return meals.map((meal, index) => (
		<div
			key={meal.id}
			data-slot="meal-group"
			className={cn(
				index > 0 && 'md:border-border md:mt-2 md:border-t md:pt-2',
			)}
		>
			<MealCard
				meal={meal}
				recipes={recipes}
				canMoveUp={index > 0}
				canMoveDown={index < meals.length - 1}
			/>
		</div>
	))
}

export function MealPlanCalendar({
	weekDays,
	meals,
	recipes,
	menus,
}: MealPlanCalendarProps) {
	const [selectedDate, setSelectedDate] = useState(() =>
		initialSelectedDate(weekDays, meals),
	)

	useEffect(() => {
		if (!weekDays.some((date) => serializeDate(date) === selectedDate)) {
			setSelectedDate(initialSelectedDate(weekDays, meals))
		}
	}, [weekDays, meals, selectedDate])

	const mealsByDay = new Map<string, PlanMeal[]>()
	for (const meal of meals) {
		const existing = mealsByDay.get(meal.dateStr) ?? []
		existing.push(meal)
		mealsByDay.set(meal.dateStr, existing)
	}

	const selectedDay =
		weekDays.find((date) => serializeDate(date) === selectedDate) ??
		weekDays[0]!
	const selectedMeals = mealsByDay.get(selectedDate) ?? []

	return (
		<>
			{/* Mobile: pick a day, then work with only that day's Meals. */}
			<div data-testid="mobile-plan" className="md:hidden">
				<div
					data-slot="mobile-week-days"
					className="grid grid-cols-7 gap-1 py-1"
				>
					{weekDays.map((date) => {
						const dateStr = serializeDate(date)
						const selected = dateStr === selectedDate
						const today = isToday(date)
						const mealCount = mealsByDay.get(dateStr)?.length ?? 0
						return (
							<button
								key={dateStr}
								type="button"
								onClick={() => setSelectedDate(dateStr)}
								aria-pressed={selected}
								aria-current={today ? 'date' : undefined}
								aria-label={`Show ${today ? 'Today' : formatWeekdayName(date)}, ${formatMonthDay(date)}, ${mealCount === 0 ? 'no Meals planned' : `${mealCount} ${mealCount === 1 ? 'Meal' : 'Meals'} planned`}`}
								className={cn(
									'relative flex min-h-16 min-w-0 flex-col items-center justify-center rounded-xl border px-0.5 transition-all',
									selected
										? 'border-primary bg-primary text-primary-foreground ring-primary/20 ring-2'
										: today
											? 'border-accent bg-accent/10 text-foreground'
											: 'border-border bg-card hover:border-primary/40 hover:bg-secondary/50',
									!selected &&
										!today &&
										isPast(date) &&
										'text-muted-foreground/65',
								)}
							>
								{today ? (
									<span
										aria-hidden="true"
										className="bg-accent absolute top-1.5 h-0.5 w-4 rounded-full"
									/>
								) : null}
								<span className="text-[9px] font-semibold tracking-wide uppercase">
									{today ? 'Today' : formatWeekdayName(date).slice(0, 3)}
								</span>
								<span className="mt-0.5 font-serif text-lg">
									{date.getUTCDate()}
								</span>
								{mealCount > 0 ? (
									<span
										aria-hidden="true"
										className={cn(
											'absolute right-1.5 bottom-1.5 size-1.5 rounded-full',
											selected ? 'bg-primary-foreground' : 'bg-primary',
										)}
									/>
								) : null}
							</button>
						)
					})}
				</div>

				<div className="mt-7 flex flex-wrap items-end justify-between gap-4">
					<div>
						<p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
							{isToday(selectedDay) ? 'Today' : formatWeekdayName(selectedDay)}
						</p>
						<h2 className="mt-0.5 font-serif text-2xl">
							{formatMonthDay(selectedDay)}
						</h2>
					</div>
					<AddMealControl
						key={selectedDate}
						date={selectedDay}
						recipes={recipes}
						menus={menus}
						presentation="primary"
					/>
				</div>

				<div className="mt-4 space-y-3">
					{selectedMeals.length > 0 ? (
						<MealCards meals={selectedMeals} recipes={recipes} />
					) : (
						<div className="border-border/60 flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
							<span className="bg-secondary text-muted-foreground flex size-10 items-center justify-center rounded-full">
								<Icon name="calendar" size="sm" />
							</span>
							<p className="mt-3 font-serif text-lg">Nothing planned</p>
							<p className="text-muted-foreground mt-1 text-sm">
								Add a Recipe, Menu, or simple note when this day needs one.
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Desktop: the whole week as one compact chronological agenda. */}
			<div
				data-testid="desktop-plan"
				className="border-border bg-card hidden rounded-2xl border md:block"
			>
				{weekDays.map((date) => {
					const dateStr = serializeDate(date)
					const dayMeals = mealsByDay.get(dateStr) ?? []
					return (
						<section
							key={dateStr}
							className={cn(
								'border-border/80 grid grid-cols-[7.5rem_1fr] border-b last:border-b-0',
								isToday(date) &&
									"bg-accent/8 before:bg-accent relative before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
							)}
						>
							<div
								className={cn(
									'border-border/80 bg-background/35 border-r px-5',
									dayMeals.length > 0 ? 'py-4' : 'py-3',
									isToday(date) && 'border-accent/40 bg-accent/12',
								)}
							>
								<p
									className={cn(
										'text-muted-foreground text-[10px] font-semibold tracking-wider uppercase',
										isToday(date) && 'text-copper-text',
									)}
								>
									{isToday(date) ? 'Today' : formatWeekdayName(date)}
								</p>
								<p className="mt-0.5 font-serif text-lg">{date.getUTCDate()}</p>
							</div>
							<div
								className={cn(
									'min-w-0 px-5',
									dayMeals.length > 0 ? 'py-2' : 'py-1',
								)}
							>
								{dayMeals.length > 0 ? (
									<>
										<div>
											<MealCards meals={dayMeals} recipes={recipes} />
										</div>
										<AddMealControl
											date={date}
											recipes={recipes}
											menus={menus}
											presentation="row"
										/>
									</>
								) : (
									<AddMealControl
										date={date}
										recipes={recipes}
										menus={menus}
										presentation="empty-row"
									/>
								)}
							</div>
						</section>
					)
				})}
			</div>
		</>
	)
}
