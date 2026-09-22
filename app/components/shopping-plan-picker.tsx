import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { PendingButton } from '#app/components/ui/pending-button.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '#app/components/ui/popover.tsx'
import { HouseholdClientInput } from '#app/utils/household-client.tsx'
import { cn } from '#app/utils/misc.tsx'
import {
	defaultPickedLines,
	type PlanPickerDay,
	type PlanPickerLine,
} from '#app/utils/shopping-plan-picker.ts'
import { useModal } from '#app/utils/use-modal.ts'

export type PlanPickerWeek = {
	weekStart: string
	label: string
	isCurrent: boolean
}

type WeekChoices = {
	weekStart: string
	weekLabel: string
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
}

/** Ticked lines, keyed by Meal — the set the writer receives. */
type Picks = Map<string, Set<string>>

/**
 * Below Tailwind's `sm` breakpoint the picker is a sheet that runs from near
 * the top of the screen down to the bottom nav: a phone-width popover capped
 * at 60vh showed eight lines of a hundred-line week. Decided at open time, so
 * the server never has to guess the viewport.
 */
const SHEET_MEDIA_QUERY = '(max-width: 639px)'
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

function lineAmount(line: PlanPickerLine) {
	return [line.quantity, line.unit].filter(Boolean).join(' ')
}

const STATUS_NOTE: Record<PlanPickerLine['status'], string | null> = {
	needed: null,
	'on-list': 'Already on list',
	'on-hand': 'Usually on hand',
}

/**
 * From Plan (#288): pick the Meals and lines to buy for, then add them. Each
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
			const meals = result.days.flatMap((day) => day.meals)
			// Fewest taps: everything is ticked except what the household would
			// normally skip — Staples, pantry lines, and rows already on the list.
			setPicks(
				new Map(
					meals.map(
						(meal) =>
							[meal.id, new Set(defaultPickedLines(meal.lines))] as const,
					),
				),
			)
			setCollapsedMeals(new Set())
		} catch {
			if (controller.signal.aborted) return
			setChoiceState({ status: 'error' })
		}
	}, [])

	useEffect(() => () => choiceRequest.current?.abort(), [])

	const days = choiceState.status === 'success' ? choiceState.choices.days : []
	const pickedMeals = days.flatMap((day) =>
		day.meals.flatMap((meal) => {
			const lines = [...(picks.get(meal.id) ?? [])]
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
			const { createdRowCount, attachedCount, alreadyContributedCount } =
				fetcher.data
			if (createdRowCount > 0) {
				toast.success(
					`Added ${createdRowCount} item${createdRowCount === 1 ? '' : 's'} to Next shop`,
				)
			} else if (attachedCount > 0 || alreadyContributedCount > 0) {
				toast.info('Everything picked is already on your list')
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
		setPicks((current) => {
			const next = new Map(current)
			const picked = next.get(mealId) ?? new Set<string>()
			// A part-ticked Meal fills up first; only a full one empties.
			next.set(
				mealId,
				picked.size === lines.length
					? new Set()
					: new Set(lines.map((line) => line.canonicalName)),
			)
			return next
		})
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
		setPresentation(
			window.matchMedia(SHEET_MEDIA_QUERY).matches ? 'sheet' : 'popover',
		)
		setOpen(true)
		// Every open refetches: "Already on list" and the default ticks
		// describe the list as it is now, and the previous open may have
		// added to it.
		void loadWeek(week.weekStart)
	}, [loadWeek, week])

	const closePicker = useCallback(() => setOpen(false), [])

	if (!week) return null

	const isSheet = presentation === 'sheet'
	const pickedMealCount = pickedMeals.length

	const panel = (
		<div className={cn('flex min-h-0 flex-col', isSheet && 'h-full')}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 id="plan-picker-title" className="font-serif text-lg">
						What are we buying for?
					</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Pick the Meals and lines to add to Next shop.
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
			{weeks.length > 1 && (
				<div className="mt-3 flex items-center justify-between gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={weekIndex === 0}
						onClick={() => showWeek(weekIndex - 1)}
						aria-label="Previous week"
					>
						<Icon name="arrow-left" size="sm" />
					</Button>
					<span className="text-sm font-medium">{week.label}</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={weekIndex === weeks.length - 1}
						onClick={() => showWeek(weekIndex + 1)}
						aria-label="Next week"
					>
						<Icon name="arrow-right" size="sm" />
					</Button>
				</div>
			)}
			{weeks.length === 1 && (
				<p className="mt-3 text-center text-sm font-medium">{week.label}</p>
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
						'mt-3 space-y-3 overflow-y-auto overscroll-contain pr-1',
						isSheet ? 'min-h-0 flex-1' : 'max-h-[min(60vh,28rem)]',
					)}
				>
					{days.map((day) => {
						return day.meals.map((meal) => {
							const picked = picks.get(meal.id) ?? new Set<string>()
							const allPicked = picked.size === meal.lines.length
							const isExpanded = !collapsedMeals.has(meal.id)
							const panelId = `plan-picker-${meal.id}`
							// "4-recipe Meal" names nothing on its own; its Recipe
							// cards do. A single-Recipe Meal is already named after
							// its Recipe, so the familiar label is what is left to say.
							const subtitle =
								meal.recipeTitles.length > 1
									? meal.recipeTitles.join(', ')
									: meal.label
							return (
								<div key={meal.id}>
									{/* The Meal heading is what has to stay put while its
									    lines scroll, and it carries the day so the calendar
									    orientation scrolls with it. */}
									<div className="bg-popover border-border/60 sticky top-0 z-10 flex items-center gap-3 border-b">
										<button
											type="button"
											onClick={() => toggleMeal(meal.id, meal.lines)}
											aria-pressed={
												allPicked ? true : picked.size > 0 ? 'mixed' : false
											}
											aria-label={`${allPicked ? 'Untick' : 'Tick'} every line in ${meal.title}`}
											className="flex min-h-11 shrink-0 items-center"
										>
											<TickBox
												checked={allPicked}
												partial={picked.size > 0 && !allPicked}
											/>
										</button>
										<button
											type="button"
											onClick={() => toggleExpanded(meal.id)}
											aria-expanded={isExpanded}
											aria-controls={panelId}
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
									</div>
									{isExpanded && (
										<div
											id={panelId}
											className="border-border/60 ml-2.5 border-l pl-4"
										>
											{meal.lines.map((line) => {
												const isPicked = picked.has(line.canonicalName)
												const note = STATUS_NOTE[line.status]
												const amount = lineAmount(line)
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
				<fetcher.Form method="POST">
					<HouseholdClientInput />
					<input type="hidden" name="intent" value="add-from-plan" />
					<input
						type="hidden"
						name="picks"
						value={JSON.stringify(pickedMeals)}
					/>
					<PendingButton
						type="submit"
						className="mt-4 w-full"
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
			{open && isSheet && (
				<PickerSheet onClose={closePicker}>{panel}</PickerSheet>
			)}
		</>
	)
}

/**
 * Phone presentation: full width, from just under the status bar down to the
 * bottom nav, so the week gets the screen rather than a peephole. Same
 * backdrop, escape and focus handling as the other mobile sheets.
 */
function PickerSheet({
	onClose,
	children,
}: {
	onClose: () => void
	children: React.ReactNode
}) {
	const dialogRef = useModal(onClose)

	return (
		<>
			<div className="fixed inset-0 z-40 bg-black/15" onClick={onClose} />
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="plan-picker-title"
				className="animate-slide-up-reveal border-border/60 bg-popover text-popover-foreground shadow-warm-lg fixed inset-x-0 top-[calc(env(safe-area-inset-top)+2.5rem)] bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[60] flex flex-col rounded-t-xl border-t p-4"
			>
				{children}
			</div>
		</>
	)
}

function TickBox({
	checked,
	partial = false,
}: {
	checked: boolean
	partial?: boolean
}) {
	return (
		<span
			className={cn(
				'flex size-5 shrink-0 items-center justify-center rounded border',
				checked || partial
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-border bg-background',
			)}
		>
			{checked ? (
				<Icon name="check" size="xs" />
			) : partial ? (
				<span className="bg-primary-foreground h-0.5 w-2.5 rounded-full" />
			) : null}
		</span>
	)
}
