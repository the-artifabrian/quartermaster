import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { BottomSheet, opensAsSheet } from '#app/components/ui/bottom-sheet.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { PendingButton } from '#app/components/ui/pending-button.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '#app/components/ui/popover.tsx'
import { isPast, loadedToday, parseDate } from '#app/utils/date.ts'
import { HouseholdClientInput } from '#app/utils/household-client.tsx'
import { addedToExistingMessage } from '#app/utils/meal-shopping-messages.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	defaultPickedLines,
	mealPickState,
	pickableLines,
	toggleMealPicks,
	type PlanPickerDay,
	type PlanPickerLine,
} from '#app/utils/shopping-plan-picker.ts'

export type PlanPickerWeek = {
	weekStart: string
	label: string
	isCurrent: boolean
}

type WeekChoices = {
	weekStart: string
	weekLabel: string
	/** The user's today, `yyyy-MM-dd`, as the server worked it out. */
	today?: string
	days: PlanPickerDay[]
}

type ChoiceState =
	| { status: 'idle' | 'loading' }
	| { status: 'success'; choices: WeekChoices }
	| { status: 'error' }

type AddFromPlanResponse = {
	status: 'success'
	createdRowCount: number
	attachedCount: number
	alreadyContributedCount: number
	/** Later rows moved to Next shop. */
	promotedRowCount: number
}

/** Ticked lines, keyed by Meal: the set the writer receives. */
type Picks = Map<string, Set<string>>

/**
 * Below Tailwind's `sm` breakpoint the picker is a sheet that runs from near
 * the top of the screen down to the bottom nav: a phone-width popover capped
 * at 60vh showed eight lines of a hundred-line week. Decided at open time, so
 * the server never has to guess the viewport.
 */
const PICKER_TITLE = 'Add from the Plan'
const PICKER_DESCRIPTION = 'Pick the Meals and lines to add to Next shop.'
type Presentation = 'popover' | 'sheet'

function isWeekChoices(value: unknown): value is WeekChoices {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Partial<WeekChoices>
	return (
		typeof candidate.weekStart === 'string' &&
		typeof candidate.weekLabel === 'string' &&
		Array.isArray(candidate.days)
	)
}

function lineAmount(line: { quantity: string | null; unit: string | null }) {
	return [line.quantity, line.unit].filter(Boolean).join(' ')
}

/** The id of a Meal's own button, the one that folds its lines. */
function mealButtonId(mealId: string) {
	return `plan-picker-${mealId}-meal`
}

/** A `yyyy-MM-dd` day before the user's today, the same today Plan uses. */
function isPastDay(date: string, today: string) {
	return isPast(parseDate(date), today)
}

const STATUS_NOTE: Record<PlanPickerLine['status'], string | null> = {
	needed: null,
	added: 'On Shopping',
	changed: 'On Shopping',
	later: 'On Later',
	'name-on-list': 'On Shopping, not this Meal’s amount',
	'on-hand': 'Usually on hand',
}

/** The line's note. A `changed` line says what Shopping has, "8 on the list". */
function lineNote(line: PlanPickerLine) {
	if (line.status === 'changed' && line.contributed) {
		const listed = lineAmount(line.contributed)
		if (listed) return `${listed} on Shopping`
	}
	return STATUS_NOTE[line.status]
}

/**
 * From Plan: pick the Meals and lines to buy for, then add them. Each
 * ticked Meal writes through the same Meal-add path as adding that Meal from
 * Plan, so a second pick of the same Meal changes nothing.
 */
export function ShoppingPlanPicker({ weeks }: { weeks: PlanPickerWeek[] }) {
	const fetcher = useFetcher<AddFromPlanResponse>()
	const previousFetcherState = useRef(fetcher.state)
	const choiceRequest = useRef<AbortController>(null)
	const [open, setOpen] = useState(false)
	const [presentation, setPresentation] = useState<Presentation>('popover')
	const [weekIndex, setWeekIndex] = useState(() => {
		const current = weeks.findIndex((week) => week.isCurrent)
		return current === -1 ? 0 : current
	})
	const [choiceState, setChoiceState] = useState<ChoiceState>({
		status: 'idle',
	})
	const [picks, setPicks] = useState<Picks>(() => new Map())
	// Every Meal is open: seeing the lines is the point, and a disclosure in
	// front of them is a tap for nothing. This holds only the Meals the
	// household has folded away.
	const [collapsedMeals, setCollapsedMeals] = useState<ReadonlySet<string>>(
		() => new Set(),
	)

	const week = weeks[weekIndex]

	const loadWeek = useCallback(async (weekStart: string) => {
		choiceRequest.current?.abort()
		const controller = new AbortController()
		choiceRequest.current = controller
		setChoiceState({ status: 'loading' })
		try {
			const url = new URL('/resources/shopping-plan', window.location.origin)
			url.searchParams.set('weekStart', weekStart)
			const response = await fetch(url, {
				signal: controller.signal,
				headers: { Accept: 'application/json' },
				credentials: 'same-origin',
			})
			if (!response.ok) throw new Error(`Request failed: ${response.status}`)
			const result: unknown = await response.json()
			if (!isWeekChoices(result)) throw new Error('Invalid Plan response')
			setChoiceState({ status: 'success', choices: result })
			// Fewest taps: everything is ticked except what the household would
			// normally skip: Staples, pantry lines, rows already on the list, and
			// whole Meals on days already gone. Those start folded too, so the
			// week opens on what is still ahead.
			const meals = result.days.flatMap((day) =>
				day.meals.map((meal) => ({
					meal,
					past: isPastDay(day.date, loadedToday(result.today)),
				})),
			)
			setPicks(
				new Map(
					meals.map(
						({ meal, past }) =>
							[
								meal.id,
								new Set(defaultPickedLines(meal.lines, { past })),
							] as const,
					),
				),
			)
			setCollapsedMeals(
				new Set(meals.filter(({ past }) => past).map(({ meal }) => meal.id)),
			)
		} catch {
			if (controller.signal.aborted) return
			setChoiceState({ status: 'error' })
		}
	}, [])

	useEffect(() => () => choiceRequest.current?.abort(), [])

	const focusMealAfterRender = useRef<string>(null)
	useEffect(() => {
		const mealId = focusMealAfterRender.current
		if (!mealId) return
		focusMealAfterRender.current = null
		document.getElementById(mealButtonId(mealId))?.focus()
	})

	const days = choiceState.status === 'success' ? choiceState.choices.days : []
	const today =
		choiceState.status === 'success'
			? loadedToday(choiceState.choices.today)
			: ''
	// Only lines a tick can add count, so a line the Meal already has on the
	// list never reaches the writer or the button's count.
	const pickedMeals = days.flatMap((day) =>
		day.meals.flatMap((meal) => {
			const picked = picks.get(meal.id) ?? new Set<string>()
			const lines = pickableLines(meal.lines)
				.map((line) => line.canonicalName)
				.filter((name) => picked.has(name))
			return lines.length > 0 ? [{ mealId: meal.id, lines }] : []
		}),
	)
	const pickedLineCount = pickedMeals.reduce(
		(total, meal) => total + meal.lines.length,
		0,
	)

	useEffect(() => {
		if (
			previousFetcherState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data?.status === 'success'
		) {
			const {
				createdRowCount,
				attachedCount,
				alreadyContributedCount,
				promotedRowCount,
			} = fetcher.data
			if (createdRowCount > 0) {
				toast.success(
					`Added ${createdRowCount} item${createdRowCount === 1 ? '' : 's'} to Next shop`,
				)
			} else if (attachedCount > 0) {
				// The amounts joined rows already there, which now show more.
				toast.success(addedToExistingMessage(attachedCount))
			} else if (promotedRowCount > 0) {
				toast.success(
					`Moved ${promotedRowCount} item${promotedRowCount === 1 ? '' : 's'} to Next shop`,
				)
			} else if (alreadyContributedCount > 0) {
				toast.info('Everything picked is already on Shopping')
			} else {
				toast.info('Nothing to add')
			}
			setOpen(false)
		}
		previousFetcherState.current = fetcher.state
	}, [fetcher.data, fetcher.state])

	function toggleLine(mealId: string, canonicalName: string) {
		setPicks((current) => {
			const next = new Map(current)
			const lines = new Set(next.get(mealId) ?? [])
			if (lines.has(canonicalName)) lines.delete(canonicalName)
			else lines.add(canonicalName)
			next.set(mealId, lines)
			return next
		})
	}

	function toggleMeal(mealId: string, lines: PlanPickerLine[]) {
		const nextPicks = toggleMealPicks(lines, picks.get(mealId) ?? new Set())
		// A done Meal has no box, so the one just pressed is about to go.
		// Focus moves to the Meal's own button instead of the page.
		if (mealPickState(lines, nextPicks) === 'done') {
			focusMealAfterRender.current = mealId
		}
		setPicks((current) => new Map(current).set(mealId, nextPicks))
	}

	function toggleExpanded(mealId: string) {
		setCollapsedMeals((current) => {
			const next = new Set(current)
			if (!next.delete(mealId)) next.add(mealId)
			return next
		})
	}

	function showWeek(index: number) {
		const target = weeks[index]
		if (!target) return
		setWeekIndex(index)
		void loadWeek(target.weekStart)
	}

	const openPicker = useCallback(() => {
		if (!week) return
		setPresentation(opensAsSheet() ? 'sheet' : 'popover')
		setOpen(true)
		// Every open refetches: "On the list" and the default ticks
		// describe the list as it is now, and the previous open may have
		// added to it.
		void loadWeek(week.weekStart)
	}, [loadWeek, week])

	const closePicker = useCallback(() => setOpen(false), [])

	if (!week) return null

	const isSheet = presentation === 'sheet'
	const pickedMealCount = pickedMeals.length

	const panel = (
		<div className={cn('flex min-h-0 flex-col', isSheet && 'flex-1')}>
			{/* The sheet brings its own header. */}
			{!isSheet && (
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 id="plan-picker-title" className="font-serif text-lg">
							{PICKER_TITLE}
						</h2>
						<p className="text-muted-foreground mt-1 text-sm">
							{PICKER_DESCRIPTION}
						</p>
					</div>
					<button
						type="button"
						onClick={closePicker}
						className="text-muted-foreground hover:text-foreground -mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-md"
						aria-label="Close"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
			)}
			{weeks.length > 1 && (
				<div
					className={cn(
						'flex items-center justify-between gap-2',
						!isSheet && 'mt-3',
					)}
				>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="rounded-full"
						disabled={weekIndex === 0}
						onClick={() => showWeek(weekIndex - 1)}
						aria-label="Previous week"
					>
						<Icon name="chevron-left" size="md" />
					</Button>
					<span className="text-sm font-medium">{week.label}</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="rounded-full"
						disabled={weekIndex === weeks.length - 1}
						onClick={() => showWeek(weekIndex + 1)}
						aria-label="Next week"
					>
						<Icon name="chevron-right" size="md" />
					</Button>
				</div>
			)}
			{weeks.length === 1 && (
				<p
					className={cn('text-center text-sm font-medium', !isSheet && 'mt-3')}
				>
					{week.label}
				</p>
			)}
			{choiceState.status === 'loading' && (
				<p
					role="status"
					aria-live="polite"
					className="text-muted-foreground py-8 text-center text-sm"
				>
					Loading the week…
				</p>
			)}
			{choiceState.status === 'error' && (
				<div role="alert" className="py-6 text-center">
					<p className="text-sm">Couldn&rsquo;t load the Plan.</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void loadWeek(week.weekStart)}
					>
						Try again
					</Button>
				</div>
			)}
			{choiceState.status === 'success' && days.length === 0 && (
				<div role="status" className="py-6 text-center">
					<p className="text-sm">Nothing to shop for this week.</p>
					<p className="text-muted-foreground mt-1 text-xs">
						Plan a Meal, or try another week.
					</p>
				</div>
			)}
			{choiceState.status === 'success' && days.length > 0 && (
				<div
					className={cn(
						'mt-3 scrollbar-thin space-y-3 overflow-y-auto overscroll-contain pr-1',
						isSheet ? 'min-h-0 flex-1' : 'max-h-[min(60vh,28rem)]',
					)}
				>
					{days.map((day) => {
						return day.meals.map((meal) => {
							const picked = picks.get(meal.id) ?? new Set<string>()
							const pickState = mealPickState(meal.lines, picked)
							const isExpanded = !collapsedMeals.has(meal.id)
							const panelId = `plan-picker-${meal.id}`
							// "4-recipe Meal" names nothing on its own; its Recipe
							// cards do. A single-Recipe Meal is already named after
							// its Recipe, so the familiar label is what is left to say.
							const subtitle = [
								isPastDay(day.date, today) ? 'Already past' : null,
								meal.recipeTitles.length > 1
									? meal.recipeTitles.join(', ')
									: meal.label,
							]
								.filter(Boolean)
								.join(' · ')
							return (
								<div key={meal.id}>
									{/* The Meal heading is what has to stay put while its
									    lines scroll, and it carries the day so the calendar
									    orientation scrolls with it. */}
									<div className="bg-popover border-border/60 sticky top-0 z-10 flex items-center gap-3 border-b">
										{pickState === 'done' ? (
											// Nothing left to buy, so no button: a tap that ticked
											// the salt would make the done check mean "add salt".
											// An on-hand line can still be ticked on its own, and
											// the box comes back while it is.
											<span className="flex min-h-11 shrink-0 items-center">
												<TickBox done />
											</span>
										) : pickState === 'unpickable' ? (
											// Nothing to tick, but an amount on the list is out
											// of date, so it isn't done either: no box at all.
											<span
												aria-hidden
												className="flex min-h-11 w-5 shrink-0"
											/>
										) : (
											<button
												type="button"
												onClick={() => toggleMeal(meal.id, meal.lines)}
												aria-pressed={
													pickState === 'all'
														? true
														: pickState === 'some'
															? 'mixed'
															: false
												}
												aria-label={
													pickState === 'all'
														? `Untick every line in ${meal.title}`
														: pickState === 'none'
															? `Tick ${meal.title}`
															: `Tick every line in ${meal.title}`
												}
												className="flex min-h-11 shrink-0 items-center"
											>
												<TickBox
													checked={pickState === 'all'}
													partial={pickState === 'some'}
												/>
											</button>
										)}
										<button
											type="button"
											id={mealButtonId(meal.id)}
											onClick={() => toggleExpanded(meal.id)}
											aria-expanded={isExpanded}
											aria-controls={panelId}
											aria-describedby={
												pickState === 'done' ? `${panelId}-done` : undefined
											}
											className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1 text-left"
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">
													{day.label && (
														<span className="text-muted-foreground font-normal">
															{day.label} ·{' '}
														</span>
													)}
													{meal.title}
												</span>
												{subtitle && (
													<span className="text-muted-foreground block truncate text-xs">
														{subtitle}
													</span>
												)}
											</span>
											<Icon
												name={isExpanded ? 'chevron-down' : 'chevron-right'}
												size="sm"
												className="text-muted-foreground shrink-0"
											/>
										</button>
										{pickState === 'done' && (
											// The muted check says it to the eye; this says it
											// to a screen reader, folded or not, and describes
											// the Meal's button for someone tabbing to it.
											<span id={`${panelId}-done`} className="sr-only">
												Everything to buy is on Shopping
											</span>
										)}
									</div>
									{isExpanded && (
										<div
											id={panelId}
											className="border-border/60 ml-2.5 border-l pl-4"
										>
											{meal.lines.map((line) => {
												const note = lineNote(line)
												const amount = lineAmount(line)
												const text = (
													<span className="min-w-0 flex-1">
														<span className="block text-sm">
															{line.name}
															{amount && (
																<span className="text-muted-foreground">
																	{' '}
																	· {amount}
																</span>
															)}
														</span>
														{note && (
															<span className="text-muted-foreground block text-xs">
																{note}
															</span>
														)}
													</span>
												)
												// This Meal's amount is on the list already. A tick
												// could add nothing, so it is a plain row whose note
												// says where it stands, not a toggle.
												// A changed line is the same, without the done check:
												// its note says what Shopping has instead.
												if (
													line.status === 'added' ||
													line.status === 'changed'
												) {
													return (
														<div
															key={line.canonicalName}
															className="flex min-h-11 w-full items-center gap-3 py-1"
														>
															{line.status === 'added' ? (
																<TickBox done />
															) : (
																<span aria-hidden className="size-5 shrink-0" />
															)}
															{text}
														</div>
													)
												}
												const isPicked = picked.has(line.canonicalName)
												return (
													<button
														key={line.canonicalName}
														type="button"
														onClick={() =>
															toggleLine(meal.id, line.canonicalName)
														}
														aria-pressed={isPicked}
														className="flex min-h-11 w-full items-center gap-3 py-1 text-left"
													>
														<TickBox checked={isPicked} />
														{text}
													</button>
												)
											})}
										</div>
									)}
								</div>
							)
						})
					})}
				</div>
			)}
			{choiceState.status === 'success' && days.length > 0 && (
				// A grid, so the button's wrapper and the button span the width.
				<fetcher.Form method="POST" className="mt-4 grid">
					<HouseholdClientInput />
					<input type="hidden" name="intent" value="add-from-plan" />
					<input
						type="hidden"
						name="picks"
						value={JSON.stringify(pickedMeals)}
					/>
					<PendingButton
						type="submit"
						className="w-full"
						pending={fetcher.state !== 'idle'}
						pendingLabel="Adding picked Meals to Shopping"
						disabled={pickedLineCount === 0}
					>
						{pickedLineCount > 0
							? `Add ${pickedLineCount} from ${pickedMealCount} Meal${pickedMealCount === 1 ? '' : 's'}`
							: 'Add to Next shop'}
					</PendingButton>
				</fetcher.Form>
			)}
		</div>
	)

	return (
		<>
			<Popover
				open={open && !isSheet}
				onOpenChange={(nextOpen) => {
					if (nextOpen) openPicker()
					else closePicker()
				}}
			>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-label="From Plan, pick Meals to add to Shopping"
						// Radix reports its own state, which is closed while the
						// sheet stands in for the popover.
						aria-expanded={open}
					>
						<Icon name="calendar" size="sm" />
						From Plan
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					aria-labelledby="plan-picker-title"
					className="w-[calc(100vw-2rem)] sm:w-[28rem]"
				>
					{panel}
				</PopoverContent>
			</Popover>
			{/* Phone presentation: full width, from just under the status bar
			    to the bottom edge, so the week gets the screen rather than a
			    peephole. */}
			<BottomSheet
				open={open && isSheet}
				onClose={closePicker}
				labelledBy="plan-picker-title"
				title={PICKER_TITLE}
				description={PICKER_DESCRIPTION}
				className="h-[calc(100dvh-var(--safe-top)-2.5rem)]"
				bodyClassName="flex flex-col"
			>
				{panel}
			</BottomSheet>
		</>
	)
}

/**
 * The picker's box. `done` is the muted check of something already on the
 * list: it reads as finished rather than chosen, and nothing toggles it.
 */
function TickBox({
	checked = false,
	partial = false,
	done = false,
}: {
	checked?: boolean
	partial?: boolean
	done?: boolean
}) {
	return (
		<span
			aria-hidden
			className={cn(
				'flex size-5 shrink-0 items-center justify-center rounded border',
				done
					? 'border-muted-foreground/30 bg-muted text-muted-foreground'
					: checked || partial
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-border bg-background',
			)}
		>
			{checked || done ? (
				<Icon name="check" size="xs" />
			) : partial ? (
				<span className="bg-primary-foreground h-0.5 w-2.5 rounded-full" />
			) : null}
		</span>
	)
}
