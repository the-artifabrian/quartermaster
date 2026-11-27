// The homepage's pictures of the app, drawn as a phone shows each screen
// today. The real screens submit through fetchers, load choices on demand
// and switch their layout on the viewport (`phone:`, `max-md:`), so they
// can't render here at a phone's size on a wide page. These copy their
// markup and tokens at the phone's sizes; keep them in step when a screen
// changes.

import { type ReactNode } from 'react'
import {
	nextSaturday,
	planDayOnPhone,
	type StripDay,
} from '#app/utils/homepage-plan-days.ts'
import { cn } from '#app/utils/misc.tsx'
import { PhoneFrame } from './phone-frame.tsx'
import { buttonVariants } from './ui/button.tsx'
import { chipClassName } from './ui/chip.tsx'
import { Icon, type IconName } from './ui/icon.tsx'
import { tabTitleClassName } from './ui/title-add-button.tsx'

/** A phone's page edge: 16px each side, as `container` draws it. */
const page = 'px-4'

// ── Plan ──────────────────────────────────────────────────────────────────

type MockDish = { name: string; multiplier?: number; cooked?: boolean }
type MockMeal = {
	label: string
	time?: string
	guests?: number
	dishes: MockDish[]
	/** The Meal's dots menu, drawn open. */
	menuOpen?: boolean
}

/** Today on a phone's Plan: breakfast eaten, lunch and dinner to come. */
const todaysMeals: MockMeal[] = [
	{
		label: 'Breakfast',
		time: '8:00 AM',
		dishes: [{ name: 'Overnight oats', cooked: true }],
	},
	{ label: 'Lunch', time: '12:30 PM', dishes: [{ name: 'Red lentil soup' }] },
	{
		label: 'Dinner',
		time: '7:00 PM',
		dishes: [{ name: 'Miso-glazed salmon' }, { name: 'Sesame greens' }],
	},
]

/** The coming Saturday: one dinner for guests, the roast doubled. */
const saturdayMeals: MockMeal[] = [
	{
		label: 'Dinner',
		time: '7:30 PM',
		guests: 6,
		menuOpen: true,
		dishes: [
			{ name: 'Roast chicken', multiplier: 2 },
			{ name: 'Focaccia' },
			{ name: 'Green salad' },
		],
	},
]

/** Days of the week that show a dot for planned Meals. */
const plannedWeekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

/** The hero's phone: Plan with today picked. */
export function TodayPlanPhone({ today }: { today: string }) {
	const day = planDayOnPhone(today, today)
	return (
		<PhoneFrame
			label={`The Plan on a phone: today, ${day.weekdayName}, ${day.heading}, with breakfast cooked, then lunch and dinner`}
		>
			<PlanScreen day={day} meals={todaysMeals} />
		</PhoneFrame>
	)
}

/** Plan on the coming Saturday, a dinner for guests with its menu open. */
export function GuestsPlanPhone({ today }: { today: string }) {
	const day = planDayOnPhone(today, nextSaturday(today))
	return (
		<PhoneFrame
			label={`The Plan on a phone: ${day.weekdayName}, ${day.heading}, a dinner for 6 guests of roast chicken, focaccia and green salad, with its menu open`}
		>
			<PlanScreen day={day} meals={saturdayMeals} />
		</PhoneFrame>
	)
}

/** MealPlanCalendar and MealCard's `day` layout on a phone. */
function PlanScreen({
	day,
	meals,
}: {
	day: ReturnType<typeof planDayOnPhone>
	meals: MockMeal[]
}) {
	const [start, ...rest] = day.range.split(' – ')
	return (
		<>
			<div className={cn('bg-background border-border border-b', page)}>
				<div className="flex items-center pt-4">
					<p className={cn(tabTitleClassName, 'mr-auto shrink-0')}>Plan</p>
					<div className="-ml-1 flex min-w-0 items-center">
						<span className="text-muted-foreground -mr-2 flex size-11 shrink-0 items-center justify-center">
							<Icon name="chevron-left" size="md" />
						</span>
						<p
							data-week-range=""
							className="min-w-0 text-center text-[15px] leading-tight font-semibold text-balance tabular-nums"
						>
							<span className="whitespace-nowrap">{start} –</span>{' '}
							<span className="whitespace-nowrap">{rest.join(' – ')}</span>
						</p>
						<span className="text-muted-foreground -ml-2 flex size-11 shrink-0 items-center justify-center">
							<Icon name="chevron-right" size="md" />
						</span>
					</div>
					<span className="ml-1">
						<AddButton />
					</span>
				</div>
				<div className="grid grid-cols-7 pt-[18px] pb-2">
					{day.strip.map((stripDay) => (
						<StripDayCell key={stripDay.date} day={stripDay} />
					))}
				</div>
			</div>
			<div className={page}>
				{day.otherWeek ? (
					<p className="text-primary -mb-3 flex min-h-11 items-center text-sm font-medium">
						This week
					</p>
				) : null}
				<div className="pt-5 pb-3">
					<p
						className={cn(
							'text-label font-semibold',
							day.label === 'Today' ? 'text-primary' : 'text-muted-foreground',
						)}
					>
						{day.label}
					</p>
					<p
						data-day-heading=""
						className="mt-0.5 font-serif text-[31px] leading-[1.1]"
					>
						{day.heading}
					</p>
				</div>
				{meals.map((meal) => (
					<MealOnDay key={meal.label} meal={meal} />
				))}
				<p className="text-primary border-border flex min-h-11 items-center gap-2 border-t text-[15px] font-semibold">
					<Icon name="plus" className="size-[18px]" />
					Add Meal
				</p>
			</div>
		</>
	)
}

function StripDayCell({ day }: { day: StripDay }) {
	const planned = plannedWeekdays.has(day.weekday)
	return (
		<span className="flex min-h-11 min-w-0 flex-col items-center gap-[5px]">
			<span
				className={cn(
					'text-label font-semibold',
					day.today ? 'text-primary' : 'text-muted-foreground',
				)}
			>
				{day.weekday}
			</span>
			<span
				data-strip-day=""
				data-picked={day.picked ? '' : undefined}
				data-today={day.today ? '' : undefined}
				className={cn(
					'flex size-[38px] items-center justify-center rounded-full text-[17px] font-medium tabular-nums',
					day.picked
						? 'bg-primary-fill text-primary-foreground font-semibold'
						: day.today
							? 'text-primary font-semibold'
							: day.past
								? 'text-faint'
								: 'text-foreground',
				)}
			>
				{day.dayOfMonth}
			</span>
			<span
				className={cn(
					'size-[5px] rounded-full',
					!planned
						? 'invisible'
						: day.picked
							? 'bg-primary'
							: 'bg-control-edge',
				)}
			/>
		</span>
	)
}

function MealOnDay({ meal }: { meal: MockMeal }) {
	return (
		<div className="border-border relative border-t pb-2">
			<div className="-mb-1 flex min-h-11 items-center">
				<div className="text-muted-foreground text-label flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 font-semibold">
					<span>{meal.label}</span>
					{meal.time ? (
						<span className="inline-flex items-center gap-0.5">
							<Icon name="clock" className="size-3" />
							{meal.time}
						</span>
					) : null}
					{meal.guests ? <span>· {meal.guests} guests</span> : null}
				</div>
				<span className="text-muted-foreground flex size-11 shrink-0 items-center justify-center">
					<Icon name="plus" className="size-5" />
				</span>
				<span
					className={cn(
						'-mr-3 flex size-11 shrink-0 items-center justify-center',
						meal.menuOpen ? 'text-foreground' : 'text-muted-foreground',
					)}
				>
					<Icon name="dots-horizontal" className="size-5" />
				</span>
			</div>
			<div className="space-y-2">
				{meal.dishes.map((dish) => (
					<div key={dish.name} className="flex items-center gap-1">
						<p
							className={cn(
								'text-dish flex min-h-11 min-w-0 flex-1 items-center py-1.5 font-medium',
								dish.cooked && 'text-faint line-through',
							)}
						>
							{dish.name}
						</p>
						{meal.dishes.length > 1 ? (
							<span className="text-foreground-destructive flex size-11 shrink-0 items-center justify-center">
								<Icon name="trash" className="size-3.5" />
							</span>
						) : null}
						<ScaleField multiplier={dish.multiplier ?? 1} />
						<span className="-mr-2.5 flex size-11 shrink-0 items-center justify-center">
							<CheckCircle checked={Boolean(dish.cooked)} />
						</span>
					</div>
				))}
			</div>
			{meal.menuOpen ? <MealMenu /> : null}
		</div>
	)
}

/** A Recipe's scale field in a Meal: a quiet fill, the × inside, 1× muted. */
function ScaleField({ multiplier }: { multiplier: number }) {
	return (
		<span className="bg-muted/70 flex h-7 min-w-11 shrink-0 items-center justify-center gap-0.5 rounded-md pr-2 pl-1.5">
			<span
				className={cn(
					'text-xs tabular-nums',
					multiplier === 1 && 'text-muted-foreground',
				)}
			>
				{multiplier}
			</span>
			<span className="text-muted-foreground text-sm">×</span>
		</span>
	)
}

/** A Meal's dots menu, opened under its button (DropdownMenuContent). */
function MealMenu() {
	const item =
		'relative flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm'
	return (
		<div className="bg-popover text-popover-foreground border-border shadow-warm-md absolute top-11 right-0 z-10 min-w-[8rem] rounded-lg border p-1">
			<p className={item}>
				<Icon name="check" size="sm" />
				Mark cooked
			</p>
			<p className={item}>
				<Icon name="pencil-1" size="sm" />
				Edit details
			</p>
			<p className={item}>
				<Icon name="cart" size="sm" />
				Add to Shopping
			</p>
			<div className="bg-muted -mx-1 my-1 h-px" />
			<p className={cn(item, 'text-foreground-destructive')}>
				<Icon name="trash" size="sm" />
				Delete
			</p>
		</div>
	)
}

/** The 24px check circle Plan's dishes and Shopping's rows share. */
function CheckCircle({ checked }: { checked: boolean }) {
	return (
		<span
			className={cn(
				'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
				checked
					? 'border-primary-fill bg-primary-fill text-primary-foreground'
					: 'border-control-edge',
			)}
		>
			{checked ? <Icon name="check" className="size-3.5" /> : null}
		</span>
	)
}

/** The round green + beside a tab's title (TitleAddButton). */
function AddButton() {
	return (
		<span
			className={cn(
				buttonVariants({
					className: 'size-11 shrink-0 rounded-full p-0',
				}),
			)}
		>
			<Icon name="plus" size="sm" />
		</span>
	)
}

// ── Recipe ────────────────────────────────────────────────────────────────

type MockIngredient = {
	amount: string
	unit?: string
	name: string
	note?: string
	checked?: boolean
}

/** At 2×, as the page shows them scaled. */
const salmonIngredients: MockIngredient[] = [
	{ amount: '8', name: 'salmon fillets', note: 'skin on', checked: true },
	{ amount: '6', unit: 'tbsp', name: 'white miso', checked: true },
	{ amount: '4', unit: 'tbsp', name: 'mirin' },
	{ amount: '2', name: 'limes', note: 'cut into wedges' },
]

const salmonSteps: ReactNode[] = [
	'Whisk the miso and mirin into a paste. Coat the salmon all over.',
	<>
		Rest <Cue>20 minutes</Cue>, or overnight in the fridge.
	</>,
	'Grill skin side down until the glaze blisters. Serve with the limes.',
]

/** A cooking time in a step, as a phone marks it. */
function Cue({ children }: { children: ReactNode }) {
	return (
		<span className="decoration-primary font-semibold underline decoration-[1.5px] underline-offset-4">
			{children}
		</span>
	)
}

/** The Recipe page on a phone, for a Recipe without a photo. */
export function RecipePhone() {
	return (
		<PhoneFrame label="A Recipe on a phone: Miso-glazed salmon, scaled to 2×, two ingredients checked off, and its first steps">
			{/* The nav bar (NavBar): Back, then the page's own buttons. */}
			<div
				className={cn(
					'bg-card border-border/50 grid h-11 shrink-0 grid-cols-[max-content_1fr_max-content] items-center border-b',
					page,
				)}
			>
				<span className="text-primary -ml-3 flex min-h-11 items-center gap-0.5 px-2 pl-1 text-[17px] leading-none">
					<Icon name="chevron-left" className="size-6 shrink-0" />
					Recipes
				</span>
				<span />
				<span className="-mr-[11px] flex items-center">
					{(['heart-filled', 'share', 'dots-horizontal'] as IconName[]).map(
						(name) => (
							<span
								key={name}
								className={cn(
									'flex size-11 items-center justify-center',
									name === 'heart-filled' ? 'text-primary' : 'text-foreground',
								)}
							>
								<Icon name={name} className="size-[22px]" />
							</span>
						),
					)}
				</span>
			</div>
			<div className={cn('pt-4', page)}>
				<p className="text-recipe-title font-serif leading-(--text-recipe-title--line-height) tracking-[-0.02em]">
					Miso-glazed salmon
				</p>
				<dl className="mt-[18px] flex flex-wrap gap-x-[30px] gap-y-3">
					{[
						['Active', '10 min'],
						['Total', '25 min'],
						['Makes', '8 servings'],
					].map(([term, value]) => (
						<div key={term}>
							<dt className="text-muted-foreground text-label font-semibold">
								{term}
							</dt>
							<dd className="mt-px text-base font-semibold">{value}</dd>
						</div>
					))}
				</dl>
				<div className="mt-5 flex gap-2">
					<span
						className={cn(
							buttonVariants({
								className: 'h-12 min-w-0 flex-1 text-base font-semibold',
							}),
						)}
					>
						<Icon name="calendar" size="md" />
						Add to Plan
					</span>
					<span
						className={cn(
							buttonVariants({
								variant: 'secondary',
								className: 'h-12 px-5 text-base font-semibold',
							}),
						)}
					>
						<Icon name="pencil-1" size="md" />
						Edit
					</span>
				</div>
				<div className="mt-4 mb-4 flex flex-wrap items-center gap-1">
					<span className="flex min-h-11 items-center gap-1.5 pr-1">
						<span className="text-recipe-section font-serif">Ingredients</span>
						<Icon
							name="chevron-down"
							size="sm"
							className="text-muted-foreground"
						/>
					</span>
					<span className="ml-auto flex items-center gap-1">
						<span className="text-muted-foreground flex min-h-11 items-center gap-1 px-2 text-sm">
							Scale
							<span className="text-foreground tabular-nums">2×</span>
							<Icon name="chevron-down" size="xs" />
						</span>
						<span className={chipClassName(false)}>Metric</span>
					</span>
					<span className="text-muted-foreground basis-full text-xs leading-relaxed">
						Makes 8 servings · original: 4
					</span>
				</div>
				<ul className="text-ingredient space-y-1 leading-(--text-ingredient--line-height)">
					{salmonIngredients.map((item) => (
						<li key={item.name} className="flex min-h-11 items-center gap-3">
							<span
								className={cn(
									'min-w-0 flex-1 py-2.5',
									item.checked && 'text-faint',
								)}
							>
								<span className="font-semibold">{item.amount} </span>
								{item.unit ? (
									<span className="font-semibold">{item.unit} </span>
								) : null}
								<span
									className={cn(
										item.checked && 'decoration-faint/60 line-through',
									)}
								>
									{item.name}
									{item.note ? (
										<span
											className={item.checked ? '' : 'text-muted-foreground'}
										>
											, {item.note}
										</span>
									) : null}
								</span>
							</span>
							{item.checked ? null : (
								<span className="text-muted-foreground/70 -mr-3.5 flex size-11 shrink-0 items-center justify-center">
									<Icon name="cart" className="size-4" />
								</span>
							)}
						</li>
					))}
				</ul>
				<p className="text-recipe-section mt-5 mb-4 font-serif">Instructions</p>
				<ol>
					{salmonSteps.map((step, index) => (
						<li
							key={index}
							className="grid grid-cols-[2.375rem_minmax(0,1fr)] py-[11px]"
						>
							<span className="text-step-number text-primary pt-px font-serif font-normal">
								{index + 1}
							</span>
							<span className="text-step leading-(--text-step--line-height)">
								{step}
							</span>
						</li>
					))}
				</ol>
			</div>
		</PhoneFrame>
	)
}

// ── Staples ───────────────────────────────────────────────────────────────

const staples = [
	{ name: 'black pepper' },
	{ name: 'butter' },
	{ name: 'eggs' },
	{ name: 'garlic' },
	{ name: 'limes', onList: true },
	{ name: 'olive oil' },
	{ name: 'plain flour' },
	{ name: 'rice' },
	{ name: 'soy sauce' },
	{ name: 'white miso', onList: true },
]

/** The Staples tab on a phone (ActiveStaples). */
export function StaplesPhone() {
	return (
		<PhoneFrame label="Staples on a phone: ten usual items in A to Z order, two of them already on Next shop">
			<div className={cn('pt-4', page)}>
				<div className="flex items-center justify-between gap-3">
					<p className={tabTitleClassName}>Staples</p>
					<AddButton />
				</div>
				<p className="text-muted-foreground mt-1 text-sm">
					Things you usually have. Add one to put it on Next shop.
				</p>
				{/* Search shows from 12 Staples. */}
				<div className="border-input bg-background text-muted-foreground mt-4 flex h-11 items-center gap-2 rounded-md border px-3 text-base">
					<Icon name="magnifying-glass" size="sm" />
					Search
				</div>
				<ul className="divide-border/40 mt-5 divide-y border-t">
					{staples.map((staple) => (
						<li key={staple.name} className="flex items-center gap-2 py-1">
							<span className="min-w-0 flex-1 truncate">{staple.name}</span>
							<span
								className={cn(
									buttonVariants({
										variant: staple.onList ? 'ghost' : 'outline',
										className: 'min-w-24 shrink-0 justify-center px-3',
									}),
								)}
							>
								{staple.onList ? (
									<>
										<Icon name="check" size="sm" />
										<span className="text-muted-foreground">On list</span>
									</>
								) : (
									'Need'
								)}
							</span>
						</li>
					))}
				</ul>
			</div>
		</PhoneFrame>
	)
}

// ── Shopping ──────────────────────────────────────────────────────────────

const toBuy = [
	{ name: 'black beans', amount: '2 cans' },
	{ name: 'corn tortillas', amount: '12' },
	{ name: 'feta', amount: '200 g' },
	{ name: 'lemons', amount: '2' },
	{ name: 'salmon fillets', amount: '8' },
	{ name: 'spring onions', amount: '1 bunch' },
	{ name: 'whole chicken', amount: '2' },
]
const checkedRows = [
	{ name: 'spaghetti', amount: '500 g' },
	{ name: 'parmesan', amount: '1 wedge' },
]

/** Shopping on a phone (ShoppingScreen), its Next shop part checked. */
export function ShoppingPhone() {
	return (
		<PhoneFrame label="Shopping on a phone: 7 to buy, and 2 of 9 checked, with Clear checked">
			<div className={cn('pt-4 pb-2', page)}>
				<p className={tabTitleClassName}>
					Shopping{' '}
					<span className="text-muted-foreground inline-block font-sans text-base font-normal whitespace-nowrap tabular-nums">
						{toBuy.length} to buy
					</span>
				</p>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<ShoppingSourceButton icon="file-text">
						From Staples
					</ShoppingSourceButton>
					<ShoppingSourceButton icon="calendar">From Plan</ShoppingSourceButton>
				</div>
			</div>
			<div className={cn('pt-2', page)}>
				<div className="divide-border/40 mt-2 divide-y">
					{toBuy.map((row) => (
						<ShoppingRow key={row.name} {...row} />
					))}
				</div>
				{/* On a phone the checked rows gather under their own heading. */}
				<div className="border-border mt-6 flex min-h-11 items-center gap-2 border-b">
					<span className="text-label font-semibold">Checked</span>
					<span className="text-muted-foreground text-label tabular-nums">
						{checkedRows.length} of {toBuy.length + checkedRows.length}
					</span>
					<span className="text-primary text-label -mr-3 ml-auto flex min-h-11 items-center px-3 font-semibold">
						Clear checked
					</span>
				</div>
				<div className="divide-border/40 divide-y">
					{checkedRows.map((row) => (
						<ShoppingRow key={row.name} {...row} checked />
					))}
				</div>
			</div>
			{/* The floating add pill, above the tab bar. */}
			<div className="absolute right-0 bottom-0 flex justify-end px-4 py-3">
				<span className="bg-card text-foreground border-border shadow-warm-md flex h-12 items-center gap-2 rounded-full border pr-5 pl-4 text-base font-medium dark:border-white/20">
					<Icon name="plus" className="text-primary size-4" />
					Add an item
				</span>
			</div>
		</PhoneFrame>
	)
}

function ShoppingSourceButton({
	icon,
	children,
}: {
	icon: IconName
	children: ReactNode
}) {
	return (
		<span className="bg-muted inline-flex h-11 items-center justify-center gap-2 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap">
			<Icon name={icon} size="sm" />
			{children}
		</span>
	)
}

function ShoppingRow({
	name,
	amount,
	checked = false,
}: {
	name: string
	amount: string
	checked?: boolean
}) {
	return (
		<div className="-mr-3.5 flex items-center gap-3">
			<div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5">
				<CheckCircle checked={checked} />
				<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
					<span
						className={cn(
							'text-item-name font-medium',
							checked &&
								'text-faint decoration-faint line-through decoration-2',
						)}
					>
						{name}
					</span>
					<span
						className={cn(
							'text-sm',
							checked ? 'text-faint' : 'text-muted-foreground',
						)}
					>
						{amount}
					</span>
				</div>
			</div>
			<span className="text-muted-foreground/70 flex size-11 shrink-0 items-center justify-center">
				<Icon name="dots-horizontal" className="size-4" />
			</span>
		</div>
	)
}
