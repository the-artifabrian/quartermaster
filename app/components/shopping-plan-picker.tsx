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
	const [weekIndex, setWeekIndex] = useState(() => {
		const current = weeks.findIndex((week) => week.isCurrent)
		return current === -1 ? 0 : current
	})
	const [choiceState, setChoiceState] = useState<ChoiceState>({
		status: 'idle',
	})
	const [picks, setPicks] = useState<Picks>(() => new Map())

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
			// normally skip — Staples, pantry lines, and rows already on the list.
			setPicks(
				new Map(
					result.days.flatMap((day) =>
						day.meals.map(
							(meal) =>
								[meal.id, new Set(defaultPickedLines(meal.lines))] as const,
						),
					),
				),
			)
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

	function showWeek(index: number) {
		const target = weeks[index]
		if (!target) return
		setWeekIndex(index)
		void loadWeek(target.weekStart)
	}

	if (!week) return null

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen)
				// Every open refetches: "Already on list" and the default ticks
				// describe the list as it is now, and the previous open may have
				// added to it.
				if (nextOpen) void loadWeek(week.weekStart)
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label="From Plan, pick Meals to add to Shopping"
				>
					<Icon name="calendar" size="sm" />
					From Plan
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))]">
				<h2 className="font-serif text-lg">What are we buying for?</h2>
				<p className="text-muted-foreground mt-1 text-sm">
					Pick the Meals and lines to add to Next shop.
				</p>
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
					<div className="mt-3 max-h-80 space-y-4 overflow-y-auto">
						{days.map((day) => (
							<div key={day.date}>
								<p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
									{day.label}
								</p>
								{day.meals.map((meal) => {
									const picked = picks.get(meal.id) ?? new Set<string>()
									const allPicked = picked.size === meal.lines.length
									return (
										<div key={meal.id} className="mt-2">
											<button
												type="button"
												onClick={() => toggleMeal(meal.id, meal.lines)}
												aria-pressed={
													allPicked ? true : picked.size > 0 ? 'mixed' : false
												}
												className="flex min-h-11 w-full items-center gap-3 text-left"
											>
												<TickBox
													checked={allPicked}
													partial={picked.size > 0 && !allPicked}
												/>
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">
														{meal.title}
													</span>
													{meal.label && (
														<span className="text-muted-foreground block text-xs">
															{meal.label}
														</span>
													)}
												</span>
											</button>
											<div className="border-border/60 ml-2.5 border-l pl-4">
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
																<span className="block truncate text-sm">
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
										</div>
									)
								})}
							</div>
						))}
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
								? `Add ${pickedLineCount} to Next shop`
								: 'Add to Next shop'}
						</PendingButton>
					</fetcher.Form>
				)}
			</PopoverContent>
		</Popover>
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
