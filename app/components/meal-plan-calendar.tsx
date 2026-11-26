import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'
import {
	useFetcher,
	useFetchers,
	useNavigate,
	useNavigation,
	useSearchParams,
} from 'react-router'
import { toast } from 'sonner'
import {
	PlanChoiceRequestState,
	type PlanChoices,
	usePlanChoices,
} from '#app/components/plan-choices.tsx'
import { useDaySwipe } from '#app/hooks/use-day-swipe.ts'
import { useHorizontalSwipe } from '#app/hooks/use-horizontal-swipe.ts'
import { type PlannedMealResult } from '#app/routes/plan/plan-action.server.ts'
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
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { stepDay } from '#app/utils/plan-day-swipe.ts'
import { haptic } from '#app/utils/shell-bridge.ts'
import { settleCommit } from '#app/utils/swipe.ts'
import {
	defaultSelectedDay,
	resolveSelectedDay,
	selectedDayFromUrl,
} from '#app/utils/plan-day-param.ts'
import { type MealLayout, type PlanMeal, MealCard } from './meal-card.tsx'
import { RowCollapse } from './ui/row-collapse.tsx'
import { useEnteringRows, useHiddenRows } from './undo-delete.tsx'
import { type PlanItemChoice, PlanItemSelector } from './recipe-selector.tsx'
import { BottomSheet, opensAsSheet } from './ui/bottom-sheet.tsx'
import { Button } from './ui/button.tsx'
import { Chip } from './ui/chip.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { TitleAddButton } from './ui/title-add-button.tsx'

type MealPlanCalendarProps = {
	weekDays: Date[]
	meals: PlanMeal[]
	/** The user's today, `yyyy-MM-dd`, from the loader (see `getRequestToday`). */
	today: string
	/** Swiping the phone's day strip sideways turns the week. */
	onSwipeWeek?: (direction: 'previous' | 'next') => void
	/**
	 * The page's title and week navigation, given the phone's + (Add Meal to
	 * the day showing) to place beside the title. The day is chosen in here,
	 * so the title row is rendered in here too.
	 */
	renderHeader?: (titleAction: ReactNode) => ReactNode
	/** On a phone, shown at the top of the day, under the pinned strip. */
	belowStrip?: ReactNode
}

/**
 * The side the next week's strip comes in from after a swipe (the opposite
 * of where the last one left), and the week it left. The calendar remounts
 * per week, so this outlives the strip that set it.
 */
let weekStripEntry: { side: -1 | 1; from: string } | null = null

/** A week slower than this to load brings its old strip back meanwhile. */
const WEEK_LOAD_GRACE_MS = 300

type AddMealPresentation = 'title' | 'foot' | 'row' | 'empty-row'

type AddMealActionData = {
	status: 'success' | 'error'
	menuError?: string
	meal?: PlannedMealResult
}

/**
 * One add flow with three launch points: on a phone the round + beside the
 * Plan title and the Add Meal row at the foot of the day, both for the day
 * showing, and a quiet row inside each desktop agenda day. The phone's two
 * always open a sheet (a centered dialog from `sm`); the agenda's rows open
 * it in place when wide.
 */
function AddMealControl({
	date,
	choices,
	presentation,
}: {
	date: Date
	choices: PlanChoices
	presentation: AddMealPresentation
}) {
	const fetcher = useFetcher<AddMealActionData>()
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)
	// On a phone the composer is a bottom sheet; wider, it opens in place.
	const [asSheet, setAsSheet] = useState(false)
	const [mode, setMode] = useState<'item' | 'text'>('item')
	const [label, setLabel] = useState<MealType | null>(null)
	const [text, setText] = useState('')
	const [pendingMenuSubmission, setPendingMenuSubmission] = useState(false)
	const [menuError, setMenuError] = useState<string | null>(null)
	const menuSubmissionStarted = useRef(false)
	// Recipe quick-add closes optimistically, so its result is reported after
	// the fact; the submitted label is captured because `close()` clears it.
	const [pendingRecipeAdd, setPendingRecipeAdd] = useState(false)
	const recipeSubmissionStarted = useRef(false)
	const submittedLabel = useRef<MealType | null>(null)
	const submittedRecipeTitle = useRef('')
	const dateLabel = `${formatWeekdayName(date)}, ${formatMonthDay(date)}`

	useEffect(() => {
		if (!pendingMenuSubmission) return
		if (fetcher.state !== 'idle') {
			menuSubmissionStarted.current = true
			return
		}
		// Ignore the idle render immediately before React Router starts the
		// submission. This also keeps a previous error from winning a retry race.
		if (!menuSubmissionStarted.current) return

		menuSubmissionStarted.current = false
		setPendingMenuSubmission(false)
		if (fetcher.data?.status === 'success') {
			setOpen(false)
		} else {
			setMenuError(
				fetcher.data?.menuError ??
					'Could not add this Menu. Check it and try again.',
			)
		}
	}, [fetcher.data, fetcher.state, pendingMenuSubmission])

	useEffect(() => {
		if (!pendingRecipeAdd) return
		if (fetcher.state !== 'idle') {
			recipeSubmissionStarted.current = true
			return
		}
		if (!recipeSubmissionStarted.current) return

		recipeSubmissionStarted.current = false
		setPendingRecipeAdd(false)
		const meal = fetcher.data?.meal
		if (fetcher.data?.status !== 'success') {
			toast.error(`Could not add ${submittedRecipeTitle.current} to Plan`)
			return
		}
		// A semantic match keeps its own multiplier, so say what is planned and
		// point at that Meal rather than implying this scale was applied.
		if (meal && !meal.created) {
			const mealLabel = submittedLabel.current
			toast.info('Already planned', {
				description: `${dateLabel}${
					mealLabel ? ` ${MEAL_TYPE_LABELS[mealLabel]}` : ''
				} · ${formatScaleMultiplier(meal.scaleMultiplier)}×`,
				duration: 8000,
				action: { label: 'View', onClick: () => navigate(meal.href) },
			})
		}
	}, [dateLabel, fetcher.data, fetcher.state, navigate, pendingRecipeAdd])

	// What the last open left behind clears on the next open, not on close,
	// so a sheet leaves showing what it showed.
	function openComposer() {
		choices.load()
		setMode('item')
		setLabel(null)
		setText('')
		setMenuError(null)
		// The phone day's two always open the sheet: the title row has no room
		// for the composer, and the foot row opens the same one.
		setAsSheet(
			presentation === 'title' || presentation === 'foot' || opensAsSheet(),
		)
		setOpen(true)
	}

	function close() {
		setOpen(false)
		setPendingMenuSubmission(false)
		menuSubmissionStarted.current = false
	}

	function submitChoice(choice: PlanItemChoice) {
		if (choice.kind === 'menu') {
			setMenuError(null)
			setPendingMenuSubmission(true)
		} else {
			submittedLabel.current = label
			submittedRecipeTitle.current = choice.recipe.title
			recipeSubmissionStarted.current = false
			setPendingRecipeAdd(true)
		}
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
		// Recipe quick-add is idempotent and keeps its existing optimistic close.
		// Menu planning can reject a stale/emptied Menu, so wait for its result.
		if (choice.kind === 'recipe') close()
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

	const fields = (
		<>
			<fieldset className="mb-3">
				<legend className="text-muted-foreground text-label mb-1.5 font-semibold">
					Label <span className="font-normal">(optional)</span>
				</legend>
				<div className="flex flex-wrap gap-2">
					{MEAL_TYPES.map((type) => (
						<Chip
							key={type}
							disabled={pendingMenuSubmission}
							onClick={() => setLabel(label === type ? null : type)}
							pressed={label === type}
						>
							{MEAL_TYPE_LABELS[type]}
						</Chip>
					))}
				</div>
			</fieldset>

			{mode === 'item' ? (
				<>
					<fieldset
						disabled={pendingMenuSubmission}
						aria-busy={pendingMenuSubmission || undefined}
						className="min-w-0 border-0 p-0 disabled:opacity-60"
					>
						{choices.state.status === 'success' ? (
							<PlanItemSelector
								recipes={choices.state.recipes}
								menus={choices.state.menus}
								date={date}
								onCancel={close}
								onPick={submitChoice}
								showClose={!asSheet}
							/>
						) : (
							<PlanChoiceRequestState
								state={choices.state.status}
								onRetry={choices.load}
								onCancel={asSheet ? undefined : close}
								subject="Recipes and Menus"
							/>
						)}
					</fieldset>
					<button
						type="button"
						onClick={() => setMode('text')}
						className="text-muted-foreground hover:text-foreground mt-0.5 -mb-3 flex min-h-11 items-center text-xs underline-offset-2 hover:underline"
					>
						Add text instead (for example, Leftovers)
					</button>
					{pendingMenuSubmission ? (
						<p role="status" className="text-muted-foreground mt-2 text-xs">
							Adding Menu…
						</p>
					) : menuError ? (
						<p
							role="alert"
							className="text-foreground-destructive mt-2 text-sm"
						>
							{menuError}
						</p>
					) : null}
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
							placeholder="Leftovers, dinner out…"
							enterKeyHint="done"
							maxLength={200}
							aria-label="Meal text"
						/>
						{/* A sheet has its own Close. */}
						{!asSheet && (
							<Button
								variant="ghost"
								size="icon"
								onClick={close}
								aria-label="Close add Meal"
							>
								<Icon name="cross-1" size="sm" />
							</Button>
						)}
					</div>
					<div
						className={cn(
							'flex items-center justify-between gap-3',
							// A sheet's primary action is full width at the bottom.
							asSheet && 'flex-col items-stretch',
						)}
					>
						<button
							type="button"
							onClick={() => {
								choices.load()
								setMode('item')
							}}
							className={cn(
								'text-muted-foreground hover:text-foreground flex min-h-11 items-center text-xs underline-offset-2 hover:underline',
								!asSheet && '-my-3.5',
							)}
						>
							Pick a Recipe or Menu instead
						</button>
						<Button
							size={asSheet ? 'default' : 'sm'}
							className={cn(asSheet && 'w-full')}
							onClick={submitText}
							disabled={!text.trim()}
						>
							Add
						</Button>
					</div>
				</div>
			)}
		</>
	)

	const trigger =
		presentation === 'title' ? (
			<TitleAddButton
				onClick={openComposer}
				aria-label={`Add Meal to ${dateLabel}`}
			/>
		) : presentation === 'foot' ? (
			// Its name is what it shows, so Voice Control taps it by "Add Meal";
			// the day heading above names the day.
			<button
				type="button"
				onClick={openComposer}
				className="text-primary hover:text-primary/75 border-border flex min-h-11 w-full items-center gap-2 border-t text-[15px] font-semibold transition-colors"
			>
				<Icon name="plus" className="size-[18px]" />
				Add Meal
			</button>
		) : presentation === 'empty-row' ? (
			<button
				type="button"
				onClick={openComposer}
				aria-label={`Add Meal to ${dateLabel}`}
				className="group flex w-full flex-col items-start pt-2 text-left text-sm transition-colors"
			>
				<span className="text-muted-foreground group-hover:text-foreground">
					Nothing planned
				</span>
				<span className="text-primary group-hover:text-primary/75 flex min-h-9 items-center gap-1 text-xs font-semibold transition-colors">
					<Icon name="plus" className="size-3" />
					Add Meal
				</span>
			</button>
		) : (
			<button
				type="button"
				onClick={openComposer}
				aria-label={`Add Meal to ${dateLabel}`}
				className="text-primary hover:text-primary/75 flex min-h-9 items-center gap-1 text-xs font-semibold transition-colors"
			>
				<Icon name="plus" className="size-3" />
				Add Meal
			</button>
		)

	// On a phone, upright or on its side, the composer is a sheet over the day.
	if (!open || asSheet) {
		return (
			<>
				{trigger}
				{asSheet && (
					<BottomSheet
						open={open}
						onClose={close}
						labelledBy={`add-meal-${presentation}-${serializeDate(date)}-title`}
						title="Add Meal"
						description={`${formatWeekdayName(date)} · ${formatMonthDay(date)}`}
					>
						{fields}
					</BottomSheet>
				)}
			</>
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
	choices,
	layout,
}: {
	meals: PlanMeal[]
	choices: PlanChoices
	layout: MealLayout
}) {
	const hidden = useHiddenRows()
	const entering = useEnteringRows()
	// A Meal deleted with Undo still waiting stays here, collapsed, so Undo can
	// open it again; order and moves count only the ones showing.
	const shown = meals.filter((meal) => !hidden.has(meal.id))
	return meals.map((meal) => {
		const index = shown.indexOf(meal)
		return (
			// A deleted Meal closes its gap, and Undo opens it again.
			<RowCollapse
				key={meal.id}
				hidden={index === -1}
				entering={entering.has(meal.id)}
				data-slot="meal-group"
				// Flat Meal rows with a hairline between the ones showing; on a
				// phone's day each Meal sits under one (DESIGN_SYSTEM, Plan).
				className={cn(
					layout === 'day'
						? 'border-border border-t'
						: index > 0 && 'border-border border-t md:mt-2 md:pt-2',
				)}
			>
				<MealCard
					meal={meal}
					choices={choices}
					layout={layout}
					canMoveUp={index > 0}
					canMoveDown={index !== -1 && index < shown.length - 1}
				/>
			</RowCollapse>
		)
	})
}

export function MealPlanCalendar({
	weekDays,
	meals,
	today: todayDate,
	onSwipeWeek,
	renderHeader,
	belowStrip,
}: MealPlanCalendarProps) {
	// The strip follows the finger and turns the week past a quarter of its
	// width or on a flick: right for the week before, left for the week after.
	// It waits while a week is loading, so a second swipe can't go from the
	// same week again.
	const navigation = useNavigation()
	const thisWeek = weekDays[0] ? serializeDate(weekDays[0]) : ''
	const turning = useRef<number | null>(null)
	const weekSwipe = useHorizontalSwipe<HTMLDivElement>({
		enabled: Boolean(onSwipeWeek) && navigation.state === 'idle',
		getBase: () => 0,
		min: -Infinity,
		max: Infinity,
		onRelease: ({ offset, velocity }): number => {
			const width: number = weekSwipe.ref.current?.offsetWidth ?? 0
			const direction = settleCommit({ offset, velocity, width })
			if (direction === 0 || !onSwipeWeek) return 0
			haptic('selection')
			weekStripEntry = { side: direction === 1 ? -1 : 1, from: thisWeek }
			onSwipeWeek(direction === 1 ? 'previous' : 'next')
			// The strip leaves; if the next week is slow to come, the old one
			// comes back dimmed rather than leave a gap.
			turning.current = window.setTimeout(() => {
				const strip = weekSwipe.ref.current
				if (strip) strip.style.opacity = '0.5'
				weekSwipe.moveTo(0, true)
			}, WEEK_LOAD_GRACE_MS)
			return direction * width
		},
	})
	// A turn that never arrives (the load failed, or went elsewhere) puts the
	// strip back. A turn that arrives remounts the calendar first.
	const { moveTo: moveWeekStrip, ref: weekStripRef } = weekSwipe
	useEffect(() => {
		if (navigation.state !== 'idle' || turning.current === null) return
		window.clearTimeout(turning.current)
		turning.current = null
		weekStripEntry = null
		const strip = weekStripRef.current
		if (strip) strip.style.opacity = ''
		moveWeekStrip(0, true)
	}, [navigation.state, moveWeekStrip, weekStripRef])
	useEffect(
		() => () => {
			if (turning.current !== null) window.clearTimeout(turning.current)
		},
		[],
	)
	useLayoutEffect(() => {
		const entry = weekStripEntry
		weekStripEntry = null
		const strip = weekSwipe.ref.current
		// Only the week the swipe went to comes in from the side.
		if (!entry || !strip || entry.from === thisWeek) return
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		strip.animate(
			still
				? [{ opacity: 0 }, { opacity: 1 }]
				: [
						{ transform: `translateX(${entry.side * 30}%)`, opacity: 0 },
						{ transform: 'none', opacity: 1 },
					],
			{ duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
		)
		// Mount only: a week's calendar is keyed by its week.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])
	const choices = usePlanChoices()
	const [searchParams, setSearchParams] = useSearchParams()
	const targetMealId = searchParams.get('mealId')
	const urlParams = {
		weekDays,
		meals,
		mealId: targetMealId,
		day: searchParams.get('day'),
		today: todayDate,
	}
	const urlDate = selectedDayFromUrl(urlParams)
	const [selectedDate, setSelectedDate] = useState(() =>
		resolveSelectedDay(urlParams),
	)
	const search = searchParams.toString()
	const defaultDate = defaultSelectedDay(weekDays, meals, todayDate)
	// The URL picks the day: a Meal link's day, else a valid `day`. A URL with
	// neither, such as the Plan tab tapped again, goes back to the default day;
	// a link to a Meal that is gone keeps the day on screen. Only a URL change
	// (or the linked Meal moving) picks again, so adding or removing a Meal
	// never moves the selection. A layout effect, so a Plan tab tap never paints
	// the old day for a frame.
	useLayoutEffect(() => {
		if (urlDate) setSelectedDate(urlDate)
		else if (!targetMealId) setSelectedDate(defaultDate)
		// Not on `defaultDate`: a Meal added or removed must not move the day.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [search, targetMealId, urlDate])

	// A later today with the same week (data cached yesterday, then
	// revalidated) moves the default day with it, unless the URL picked a day
	// or a Meal. An earlier today (an older cached entry) never moves it. Nor
	// does a later one that arrives while the person is busy: a sheet or
	// dialog open, a navigation or a fetcher under way. Moving the day then
	// would swap out what they are working on, so the day stays and Today is
	// still marked in the strip.
	const fetchers = useFetchers()
	const busy =
		navigation.state !== 'idle' ||
		fetchers.some((fetcher) => fetcher.state !== 'idle')
	const followedToday = useRef(todayDate)
	useLayoutEffect(() => {
		if (todayDate <= followedToday.current) return
		followedToday.current = todayDate
		if (busy || document.querySelector('[role="dialog"]')) return
		if (!urlDate && !targetMealId) setSelectedDate(defaultDate)
		// Only on a new today: a Meal added or removed must not move the day.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [todayDate])

	useEffect(() => {
		if (!weekDays.some((date) => serializeDate(date) === selectedDate)) {
			setSelectedDate(defaultSelectedDay(weekDays, meals, todayDate))
		}
	}, [weekDays, meals, selectedDate, todayDate])

	function selectDay(dateStr: string) {
		// The new day starts at its heading, under the pinned strip.
		if (dateStr !== selectedDate && window.scrollY > 0) window.scrollTo(0, 0)
		setSelectedDate(dateStr)
		// The day goes in the URL so back and reload return to it. Replace, so
		// day taps add no history entries; the Meal link gives way to the day.
		const next = new URLSearchParams(searchParams)
		next.delete('mealId')
		next.set('day', dateStr)
		// The same URL again would be a revalidation, reloading the week.
		if (next.toString() === search) return
		setSearchParams(next, { replace: true, preventScrollReset: true })
	}

	// A sideways swipe on the day steps to the next day or the one before,
	// past Sunday or before Monday into the next or last week. It waits while
	// a week loads, so two swipes can't both go from the old week.
	const navigate = useNavigate()
	const daySwipe = useDaySwipe<HTMLDivElement>({
		enabled: navigation.state === 'idle',
		onStep: (step) => {
			const next = stepDay(weekDays, selectedDate, step)
			haptic('selection')
			if (!next.weekStart) return selectDay(next.day)
			if (window.scrollY > 0) window.scrollTo(0, 0)
			void navigate(`/plan?weekStart=${next.weekStart}&day=${next.day}`)
		},
	})

	// Counts and empty days leave out Meals deleted with Undo still waiting.
	const hidden = useHiddenRows()
	const shownCount = (dayMeals: PlanMeal[] | undefined) =>
		dayMeals?.filter((meal) => !hidden.has(meal.id)).length ?? 0
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

	const selectedIsToday = isToday(selectedDay, todayDate)

	return (
		<>
			{/* On a phone the title row and the strip stay pinned under the
			    status bar, opaque, edge to edge; wider, they scroll as before. */}
			<div
				data-plan-header=""
				className="max-md:bg-background max-md:border-border max-md:sticky max-md:top-(--safe-top) max-md:z-30 max-md:-mx-4 max-md:border-b max-md:px-4 sm:max-md:-mx-8 sm:max-md:px-8"
			>
				{renderHeader?.(
					// Phones only, like the day it adds to; the desktop agenda has an
					// Add Meal in each day.
					<div className="md:hidden">
						<AddMealControl
							key={selectedDate}
							date={selectedDay}
							choices={choices}
							presentation="title"
						/>
					</div>,
				)}
				<div
					ref={weekSwipe.ref}
					{...weekSwipe.handlers}
					data-slot="mobile-week-days"
					className="grid touch-pan-y touch-pinch-zoom grid-cols-7 pt-[18px] pb-2 md:hidden"
				>
					{weekDays.map((date) => {
						const dateStr = serializeDate(date)
						const selected = dateStr === selectedDate
						const today = isToday(date, todayDate)
						const past = !today && isPast(date, todayDate)
						const mealCount = shownCount(mealsByDay.get(dateStr))
						return (
							<button
								key={dateStr}
								type="button"
								onClick={() => selectDay(dateStr)}
								aria-pressed={selected}
								aria-current={today ? 'date' : undefined}
								aria-label={`Show ${today ? 'Today' : formatWeekdayName(date)}, ${formatMonthDay(date)}, ${mealCount === 0 ? 'no Meals planned' : `${mealCount} ${mealCount === 1 ? 'Meal' : 'Meals'} planned`}`}
								className="group/day flex min-h-11 min-w-0 flex-col items-center gap-[5px]"
							>
								<span
									className={cn(
										'text-label font-semibold',
										today ? 'text-primary' : 'text-muted-foreground',
									)}
								>
									{formatWeekdayName(date).slice(0, 3)}
								</span>
								{/* Past days are faint, so they never sit on a fill: hover
								    turns them muted. */}
								<span
									className={cn(
										'flex size-[38px] items-center justify-center rounded-full text-[17px] font-medium tabular-nums transition-colors',
										selected
											? 'bg-primary-fill text-primary-foreground font-semibold'
											: cn(
													'group-hover/day:bg-muted',
													today
														? 'text-primary font-semibold'
														: past
															? 'text-faint group-hover/day:text-muted-foreground'
															: 'text-foreground',
												),
									)}
								>
									{date.getUTCDate()}
								</span>
								<span
									aria-hidden="true"
									className={cn(
										'size-[5px] rounded-full',
										mealCount === 0
											? 'invisible'
											: selected
												? 'bg-primary'
												: 'bg-control-edge',
									)}
								/>
							</button>
						)
					})}
				</div>
			</div>

			{/* Mobile: pick a day, then work with only that day's Meals. The
			    whole day takes the sideways swipe, its bare foot included. */}
			<div
				data-testid="mobile-plan"
				{...daySwipe}
				className="flex flex-1 touch-pan-y touch-pinch-zoom flex-col md:hidden"
			>
				{belowStrip}
				<div className="pt-5 pb-3">
					<p
						className={cn(
							'text-label font-semibold',
							selectedIsToday ? 'text-primary' : 'text-muted-foreground',
						)}
					>
						{selectedIsToday ? 'Today' : formatWeekdayName(selectedDay)}
					</p>
					<h2 className="mt-0.5 font-serif text-[31px] leading-[1.1]">
						{formatMonthDay(selectedDay)}
					</h2>
				</div>

				{shownCount(selectedMeals) > 0 ? (
					<div>
						<MealCards meals={selectedMeals} choices={choices} layout="day" />
					</div>
				) : (
					// Flat, like the Meals it stands in for.
					<div className="border-border border-t pt-[22px] pb-5">
						<p className="text-xl leading-tight font-medium">Nothing planned</p>
						<p className="text-muted-foreground mt-1 text-[15.5px]">
							Tap + to plan a Recipe, Menu, or note.
						</p>
					</div>
				)}
				<AddMealControl
					key={selectedDate}
					date={selectedDay}
					choices={choices}
					presentation="foot"
				/>
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
							// Text on the tint takes no faint color (meal-card.tsx).
							data-tinted={isToday(date, todayDate) ? '' : undefined}
							className={cn(
								'border-border/80 grid grid-cols-[7.5rem_1fr] border-b last:border-b-0',
								isToday(date, todayDate) &&
									"bg-primary-tint before:bg-primary relative before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
							)}
						>
							<div
								className={cn(
									'border-border/80 bg-background/35 border-r px-5',
									shownCount(dayMeals) > 0 ? 'py-4' : 'py-3',
									isToday(date, todayDate) &&
										'border-primary/40 bg-primary-tint',
								)}
							>
								<p
									className={cn(
										'text-muted-foreground text-label font-semibold',
										isToday(date, todayDate) && 'text-primary',
									)}
								>
									{isToday(date, todayDate) ? 'Today' : formatWeekdayName(date)}
								</p>
								<p className="mt-0.5 font-serif text-lg">{date.getUTCDate()}</p>
							</div>
							<div
								className={cn(
									'min-w-0 px-5',
									shownCount(dayMeals) > 0 ? 'py-2' : 'py-1',
								)}
							>
								{shownCount(dayMeals) > 0 ? (
									<>
										<div>
											<MealCards
												meals={dayMeals}
												choices={choices}
												layout="agenda"
											/>
										</div>
										<AddMealControl
											date={date}
											choices={choices}
											presentation="row"
										/>
									</>
								) : (
									<AddMealControl
										date={date}
										choices={choices}
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
