import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type ReactNode } from 'react'
import { data, Link, redirect } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: '', priority: 1.0 }],
}

const description =
	'Save your Recipes. Plan Meals. Make one useful Shopping list.'

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: 'Quartermaster' },
	{ name: 'description', content: description },
	{ property: 'og:title', content: 'Quartermaster' },
	{ property: 'og:description', content: description },
	...baseMetaTags(matches),
]

export const links: Route.LinksFunction = () => [
	{
		rel: 'stylesheet',
		href: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,500;0,600;1,400&display=swap',
	},
]

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	if (userId) {
		throw redirect('/recipes')
	}
	return data(null)
}

export const headers: Route.HeadersFunction = pipeHeaders

const webApplicationJsonLd = JSON.stringify({
	'@context': 'https://schema.org',
	'@type': 'WebApplication',
	name: 'Quartermaster',
	description,
	applicationCategory: 'LifestyleApplication',
	operatingSystem: 'Web',
	offers: {
		'@type': 'Offer',
		price: '0',
		priceCurrency: 'USD',
	},
}).replace(/</g, '\\u003c')

// The site chrome around this page (header, footer) is re-themed onto the
// espresso palette by the `data-chrome` attribute in root.tsx.

export default function Index() {
	return (
		<div className="bg-espresso text-cream font-humanist antialiased">
			{/* Static JSON-LD structured data (no user input) */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: webApplicationJsonLd }}
			/>
			<Hero />
			{/* Same order as the subhead: Recipes, a week, minus Staples, a list. */}
			<FeatureBand
				index={1}
				id="how-it-works"
				heading="Your Recipes, in one place"
				body="Paste a link or the text of a recipe, or type one in. Scale up for guests and check off ingredients as you cook."
				screenSide="left"
				screen={<RecipesScreen />}
			/>
			<FeatureBand
				index={2}
				heading="A week penciled in"
				body="Add Recipes to the week and group dishes into Meals. Move a Meal to another day when plans change."
				screenSide="right"
				screen={<PlanScreen />}
			/>
			<FeatureBand
				index={3}
				heading="Minus what you already have"
				body="Add the Staples you usually have. Mark one Out when you run low."
				screenSide="left"
				screen={<StaplesScreen />}
			/>
			<FeatureBand
				index={4}
				heading="The list writes itself"
				body="Generate Shopping from the week’s Meals. Staples stay off the list unless they’re Out."
				screenSide="right"
				screen={<ShoppingScreen />}
			/>
			<ClosingCta />
		</div>
	)
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
	return (
		<section className="container pt-10 pb-12 sm:pt-16 sm:pb-20 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-end lg:gap-16 lg:pt-16 lg:pb-16">
			<div className="max-w-[34rem]">
				<h1 className="font-serif text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-balance sm:text-[3.5rem] lg:text-[5.5rem]">
					What are we making this week?
				</h1>
				<p className="text-cream/80 mt-7 max-w-[30rem] text-lg leading-[1.55] sm:text-xl">
					Keep the Recipes you cook and plan a few Meals for the week.
					Quartermaster generates Shopping from the Plan, minus what you already
					have.
				</p>
				<div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-4">
					<PrimaryCta />
					<a
						href="#how-it-works"
						className="text-cream decoration-cream-muted/60 hover:decoration-cream text-base font-medium underline underline-offset-[6px] transition-colors"
					>
						See how it works
					</a>
				</div>
				<p className="text-cream-muted mt-5 text-[15px]">
					Free for 14 days. No credit card needed.
				</p>
			</div>

			<div className="mt-10 lg:mt-0">
				<PlanAgenda days={thisWeek} menus={false} />
			</div>
		</section>
	)
}

function PrimaryCta({ className }: { className?: string }) {
	return (
		<Link
			to="/signup"
			className={cn(
				'bg-sage text-sage-foreground ring-offset-espresso focus-visible:ring-sage inline-flex h-12 items-center justify-center rounded-full px-7 text-base font-semibold transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 active:brightness-95',
				className,
			)}
		>
			Start cooking
		</Link>
	)
}

// ---------------------------------------------------------------------------
// Feature bands
// ---------------------------------------------------------------------------

function FeatureBand({
	index,
	id,
	heading,
	body,
	screenSide,
	screen,
}: {
	index: number
	id?: string
	heading: string
	body: string
	screenSide: 'left' | 'right'
	screen: ReactNode
}) {
	// Even bands sink below the canvas so the screen is always the lighter
	// plane.
	const sunk = index % 2 === 0
	return (
		<section
			className={cn('py-16 sm:py-24 lg:py-28', sunk && 'bg-espresso-deep')}
		>
			{/* The anchor sits on the content, not the padded section, so "See how
			    it works" lands the band just under the header (sticky from md,
			    69px tall) instead of leaving the padding as a blank gap. */}
			<div
				id={id}
				className={cn(
					'container grid scroll-mt-6 gap-8 md:scroll-mt-24 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-20',
					screenSide === 'right' &&
						'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
				)}
			>
				{/* Caption first in the DOM so phones read heading, then screen. */}
				<div
					className={cn(
						'max-w-[28rem]',
						screenSide === 'right' ? 'lg:order-1' : 'lg:order-2',
					)}
				>
					<p className="font-serif text-2xl tabular-nums">
						{String(index).padStart(2, '0')}
					</p>
					<h2 className="mt-5 font-serif text-[2.25rem] leading-[1.1] tracking-[-0.015em] text-balance sm:text-[3rem]">
						{heading}
					</h2>
					<p className="text-cream/80 mt-6 text-lg leading-[1.55] sm:text-xl">
						{body}
					</p>
				</div>
				{/* Cap the screen at 600px and fade its tail into the canvas so the
				    number, heading, copy and screen share one viewport. */}
				<div
					className={cn(
						'max-h-150 min-w-0 overflow-hidden mask-b-from-92%',
						screenSide === 'right' ? 'lg:order-2' : 'lg:order-1',
					)}
				>
					{screen}
				</div>
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// Closing CTA — the only centered block on the page
// ---------------------------------------------------------------------------

function ClosingCta() {
	return (
		<section className="px-4 py-20 text-center sm:py-24 lg:py-28">
			<h2 className="mx-auto max-w-[22ch] font-serif text-[2.25rem] leading-[1.1] tracking-[-0.015em] text-balance sm:text-[3rem]">
				Decide dinner once, for the whole week.
			</h2>
			<p className="text-cream/80 mx-auto mt-5 max-w-[28rem] text-lg leading-[1.55]">
				Free for 14 days. Your Recipes stay on the free plan.
			</p>
			<div className="mt-9 flex justify-center">
				<PrimaryCta />
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// Static app screens. The real Plan/Shopping/Staples components submit through
// fetchers and load choices on demand, so they can't render outside their
// routes; these mirror their markup and dimensions at 1:1.
// ---------------------------------------------------------------------------

/** The page body only: the section heading already names the tab, so the
 *  app's nav bar would be repeated chrome in every frame. */
function AppScreen({
	children,
	label,
}: {
	children: ReactNode
	label: string
}) {
	return (
		<div
			role="img"
			aria-label={label}
			className="border-espresso-line bg-espresso-surface shadow-warm-lg overflow-hidden rounded-xl border"
		>
			<div aria-hidden="true">{children}</div>
		</div>
	)
}

function DoneCircle({ done }: { done: boolean }) {
	return done ? (
		<span className="border-sage bg-sage text-sage-foreground flex size-5 items-center justify-center rounded-full border-2">
			<Icon name="check" className="size-3" />
		</span>
	) : (
		<span className="border-cream-muted/40 flex size-5 rounded-full border-2" />
	)
}

/** The Meal action menu from the real Plan, opening below its trigger. */
function MealMenu() {
	const item = 'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm'
	const separator = 'bg-espresso-line/70 my-1 h-px'
	return (
		<div className="border-espresso-line bg-espresso-raised shadow-warm-md absolute top-8 right-0 z-20 w-56 rounded-lg border p-1 text-left normal-case">
			<div className={item}>
				<Icon name="arrow-up" size="sm" />
				Move earlier
			</div>
			<div className={item}>
				<Icon name="arrow-down" size="sm" />
				Move later
			</div>
			<div className={separator} />
			<div className={item}>
				<Icon name="check" size="sm" />
				Mark meal cooked
			</div>
			<div className={cn(item, 'bg-cream/8')}>
				<Icon name="pencil-1" size="sm" />
				Edit details
			</div>
			<div className={item}>
				<Icon name="cart" size="sm" />
				Add to Shopping List
			</div>
			<div className={separator} />
			<div className={item}>
				<Icon name="trash" size="sm" />
				Delete meal
			</div>
		</div>
	)
}

type PlanItem = { dish: string; multiplier?: number; done?: boolean }
type PlanMealEntry = {
	label: string
	minutes: number
	guests?: number
	items: PlanItem[]
	/** Render the Meal's action menu open, as after tapping its dots. */
	menuOpen?: boolean
}
type PlanDay = {
	day: string
	date: number
	today?: boolean
	meal?: PlanMealEntry
}

const thisWeek: PlanDay[] = [
	{
		day: 'Monday',
		date: 21,
		meal: {
			label: 'Dinner',
			minutes: 20,
			items: [{ dish: 'Pasta al limone', done: true }],
		},
	},
	{
		day: 'Tuesday',
		date: 22,
		today: true,
		meal: {
			label: 'Dinner',
			minutes: 25,
			items: [{ dish: 'Miso-glazed salmon' }],
		},
	},
	{
		day: 'Wednesday',
		date: 23,
		meal: {
			label: 'Dinner',
			minutes: 30,
			items: [{ dish: 'Black bean tacos' }],
		},
	},
	{
		day: 'Thursday',
		date: 24,
		meal: { label: 'Dinner', minutes: 45, items: [{ dish: 'Chicken tikka' }] },
	},
	{
		day: 'Friday',
		date: 25,
		meal: { label: 'Dinner', minutes: 35, items: [{ dish: 'Shakshuka' }] },
	},
	{
		day: 'Saturday',
		date: 26,
		meal: { label: 'Dinner', minutes: 40, items: [{ dish: 'Ramen' }] },
	},
	{
		day: 'Sunday',
		date: 27,
		meal: { label: 'Dinner', minutes: 90, items: [{ dish: 'Roast chicken' }] },
	},
]

/** Next week, half planned: a three-dish Meal, a doubled recipe, open days.
 *  The Meal with guests is first so the 600px crop shows it whole at every
 *  width; the open menu hangs from Tuesday so all six items sit above the
 *  crop and its fade. */
const nextWeek: PlanDay[] = [
	{
		day: 'Monday',
		date: 28,
		meal: {
			label: 'Dinner',
			minutes: 105,
			guests: 6,
			items: [
				{ dish: 'Roast chicken' },
				{ dish: 'Focaccia' },
				{ dish: 'Green salad' },
			],
		},
	},
	{
		day: 'Tuesday',
		date: 29,
		meal: {
			label: 'Dinner',
			minutes: 30,
			menuOpen: true,
			items: [{ dish: 'Black bean tacos' }],
		},
	},
	{
		day: 'Wednesday',
		date: 30,
		meal: {
			label: 'Dinner',
			minutes: 45,
			items: [{ dish: 'Chicken tikka', multiplier: 2 }],
		},
	},
	{ day: 'Thursday', date: 1 },
	{
		day: 'Friday',
		date: 2,
		meal: { label: 'Dinner', minutes: 35, items: [{ dish: 'Shakshuka' }] },
	},
	{
		day: 'Saturday',
		date: 3,
		meal: { label: 'Lunch', minutes: 40, items: [{ dish: 'Ramen' }] },
	},
	{ day: 'Sunday', date: 4 },
]

function formatMinutes(minutes: number) {
	if (minutes < 60) return `${minutes} min`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

/** The desktop week agenda from `MealPlanCalendar`, rendered statically. */
function PlanAgenda({
	days,
	framed = true,
	menus = true,
}: {
	days: PlanDay[]
	framed?: boolean
	/** Render each Meal's ⋯ trigger. Off in the hero, where it is only chrome. */
	menus?: boolean
}) {
	return (
		<div
			role={framed ? 'img' : undefined}
			aria-label={
				framed ? 'This week’s Meal Plan, Monday to Sunday' : undefined
			}
			className={cn(
				'bg-espresso-surface overflow-hidden rounded-2xl',
				framed && 'border-espresso-line shadow-warm-lg border',
				!framed && 'border-espresso-line/80 border',
			)}
		>
			{days.map((row) => (
				<section
					key={row.day}
					className={cn(
						'border-espresso-line/70 grid grid-cols-[5.75rem_1fr] border-b last:border-b-0 sm:grid-cols-[7.5rem_1fr]',
						row.today &&
							"before:bg-copper relative before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
					)}
				>
					<div
						className={cn(
							'border-espresso-line/70 bg-espresso-raised/35 border-r px-4 sm:px-5',
							row.meal ? 'py-3.5' : 'py-3',
							row.today && 'bg-copper/12',
						)}
					>
						<p
							className={cn(
								'text-cream-muted text-xs font-semibold tracking-wider uppercase',
								row.today && 'text-copper',
							)}
						>
							{row.today ? (
								'Today'
							) : (
								<>
									<span className="sm:hidden">{row.day.slice(0, 3)}</span>
									<span className="hidden sm:inline">{row.day}</span>
								</>
							)}
						</p>
						<p className="mt-0.5 font-serif text-lg">{row.date}</p>
					</div>
					<div
						className={cn('min-w-0 px-4 sm:px-5', row.meal ? 'py-3' : 'py-1')}
					>
						{row.meal ? (
							<>
								<div className="relative flex items-start justify-between gap-2">
									<div className="text-cream-muted flex min-h-6 flex-wrap items-center gap-x-1.5 text-xs font-semibold tracking-wider uppercase">
										<span>{row.meal.label}</span>
										<span className="inline-flex items-center gap-0.5 normal-case">
											<Icon name="clock" className="size-3" />
											{formatMinutes(row.meal.minutes)}
										</span>
										{row.meal.guests ? (
											<span className="normal-case">
												· {row.meal.guests} guests
											</span>
										) : null}
									</div>
									{menus ? (
										<span
											className={cn(
												'flex size-6 shrink-0 items-center justify-center rounded',
												row.meal.menuOpen
													? 'bg-espresso-raised text-cream'
													: 'text-cream-muted',
											)}
										>
											<Icon name="dots-horizontal" className="size-3.5" />
										</span>
									) : null}
									{row.meal.menuOpen ? <MealMenu /> : null}
								</div>
								<div className="mt-1 space-y-1.5">
									{row.meal.items.map((item) => (
										<div key={item.dish} className="flex items-start gap-2">
											<span className="flex h-5 items-center">
												<DoneCircle done={Boolean(item.done)} />
											</span>
											<div className="min-w-0">
												<p
													className={cn(
														'font-serif text-[15px] leading-snug',
														item.done && 'text-cream-muted line-through',
													)}
												>
													{item.dish}
												</p>
												{item.multiplier ? (
													<span className="border-espresso-line/80 mt-1 inline-flex h-7 w-16 items-center justify-center rounded-md border px-1.5 text-xs tabular-nums">
														{item.multiplier}×
													</span>
												) : null}
											</div>
										</div>
									))}
								</div>
							</>
						) : (
							<div className="flex min-h-12 items-center gap-3 text-sm">
								<span className="text-cream-muted">Nothing planned</span>
								<span className="text-sage inline-flex items-center gap-1 text-xs font-semibold">
									<Icon name="plus" className="size-3" />
									Add Meal
								</span>
							</div>
						)}
					</div>
				</section>
			))}
		</div>
	)
}

function PlanScreen() {
	return (
		<AppScreen label="The Plan page: next week’s Meal Plan, Sep 28 – Oct 4, with the action menu open on Tuesday’s dinner">
			<div className="px-5 py-4 sm:px-6">
				{/* The week row is the calendar's own title row; the section
				    heading already says which page this is. */}
				<div className="mx-auto flex max-w-2xl items-center justify-between">
					<span className="text-cream-muted flex size-9 items-center justify-center rounded-full">
						<Icon name="arrow-left" size="sm" />
					</span>
					<p className="font-serif text-lg">Sep 28 – Oct 4</p>
					<span className="text-cream-muted flex size-9 items-center justify-center rounded-full">
						<Icon name="arrow-right" size="sm" />
					</span>
				</div>
				<div className="mt-4">
					<PlanAgenda days={nextWeek} framed={false} />
				</div>
			</div>
		</AppScreen>
	)
}

const ingredients = [
	{ amount: '4', name: 'salmon fillets', notes: 'skin on', checked: true },
	{ amount: '3 tbsp', name: 'white miso', checked: true },
	{ amount: '2 tbsp', name: 'mirin' },
	{ amount: '1 tbsp', name: 'soy sauce' },
	{ amount: '2 tsp', name: 'brown sugar' },
	{ amount: '1 tbsp', name: 'rice vinegar' },
	{ amount: '2', name: 'scallions', notes: 'thinly sliced' },
	{ amount: '1', name: 'lime', notes: 'cut into wedges' },
]

const steps = [
	'Whisk the miso, mirin, soy, sugar, and vinegar into a loose paste. Pat the salmon dry and coat it on all sides.',
	'Rest 20 minutes at room temperature, or overnight in the fridge if you have the time.',
	'Heat the broiler with a rack 6 inches from the element. Line a sheet pan with foil.',
	'Broil skin side down until the glaze blisters and the edges catch, 6 to 8 minutes. Finish with scallions and a squeeze of lime.',
]

/** The Recipe detail page at rest, scaled to 2× with two ingredients checked. */
function RecipesScreen() {
	return (
		<AppScreen label="A Recipe page: Miso-glazed salmon, scaled to 2×, two ingredients checked off">
			<div className="px-5 pt-5 pb-6 sm:px-6">
				<h3 className="font-serif text-[2rem] leading-[1.15] tracking-[-0.02em]">
					Miso-glazed salmon
				</h3>
				<div className="bg-espresso-line/70 mt-3 mb-2 h-px max-w-xs" />
				<div className="text-cream-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					<span className="inline-flex items-center gap-1">
						<Icon name="timer" size="sm" className="opacity-70" />
						Active: 10 min
					</span>
					<span className="inline-flex items-center gap-1">
						<Icon name="clock" size="sm" className="opacity-70" />
						Total: 25 min
					</span>
					<span>Makes 4 servings</span>
				</div>
				<p className="text-cream-muted mt-5 text-base leading-relaxed">
					Sweet-salty glaze, broiled until the edges catch. Rice and something
					green and dinner is done.
				</p>
				<div className="text-cream-muted mt-4 flex items-center gap-1">
					{(
						['heart-filled', 'calendar', 'pencil-1', 'copy', 'share'] as const
					).map((name) => (
						<span
							key={name}
							className={cn(
								'flex size-11 items-center justify-center',
								name === 'heart-filled' && 'text-copper',
							)}
						>
							<Icon name={name} size="md" />
						</span>
					))}
				</div>

				<div className="mt-6 grid gap-6 sm:grid-cols-[6fr_7fr]">
					<div className="min-w-0">
						<div className="flex items-center gap-1">
							<p className="font-serif text-lg">Ingredients</p>
							<span className="text-cream-muted ml-auto flex items-center gap-1 px-2 text-sm">
								Scale <span className="text-cream tabular-nums">2×</span>
								<Icon name="chevron-down" size="xs" />
							</span>
							<span className="text-cream-muted flex h-8 items-center rounded-full border border-transparent px-2.5 text-xs font-medium">
								Metric
							</span>
						</div>
						<p className="text-cream-muted mt-1 text-xs">
							Makes 8 servings · 2× the original
						</p>
						<ul className="mt-3 space-y-1 leading-[1.7]">
							{ingredients.map((item) => (
								<li
									key={item.name}
									className="flex items-center gap-3 rounded-lg px-1 py-2"
								>
									<span
										className={cn(
											'flex size-6 shrink-0 items-center justify-center rounded border',
											item.checked
												? 'border-sage bg-sage text-sage-foreground'
												: 'border-cream-muted/25 bg-espresso-raised/40',
										)}
									>
										{item.checked ? (
											<Icon name="check" className="size-4" />
										) : null}
									</span>
									<span
										className={cn(
											'min-w-0 flex-1 text-[15px]',
											item.checked && 'text-cream-muted line-through',
										)}
									>
										<span className="font-medium">{scaled(item.amount)} </span>
										{item.name}
										{item.notes ? (
											<span className={item.checked ? '' : 'text-cream-muted'}>
												, {item.notes}
											</span>
										) : null}
									</span>
								</li>
							))}
						</ul>
					</div>
					<div className="min-w-0">
						<p className="mb-3 font-serif text-lg">Instructions</p>
						<ol>
							{steps.map((step, index) => (
								<li
									key={step}
									className="border-espresso-line/50 flex gap-4 border-b px-1 py-3 last:border-b-0"
								>
									<span className="text-cream-muted flex size-8 shrink-0 items-center justify-center font-serif text-xl leading-none">
										{index + 1}
									</span>
									<p className="pt-0.5 text-[15px] leading-[1.75]">{step}</p>
								</li>
							))}
						</ol>
					</div>
				</div>
			</div>
		</AppScreen>
	)
}

/** Doubles the leading number of an amount string ("3 tbsp" → "6 tbsp"). */
function scaled(amount: string) {
	return amount.replace(/^\d+/, (n) => String(Number(n) * 2))
}

const staples = [
	'all-purpose flour',
	'black pepper',
	'butter',
	'canned tomatoes',
	'eggs',
	'garlic',
]

function StaplesScreen() {
	return (
		<AppScreen label="The Staples page: two items Out, 31 usually available">
			<div className="px-5 py-5 sm:px-6">
				<h3 className="font-serif text-2xl">Staples</h3>
				<p className="text-cream-muted mt-1 text-sm">
					Things you usually have. Mark one Out to add it to Next shop.
				</p>
				<div className="mt-4 flex gap-2">
					<div className="border-espresso-line/60 bg-espresso-raised/50 text-cream-muted flex h-11 flex-1 items-center gap-2 rounded-lg border px-3 text-sm">
						<Icon name="magnifying-glass" size="sm" />
						Search
					</div>
					<span className="bg-sage text-sage-foreground inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium">
						<Icon name="plus" size="sm" />
						Add
					</span>
				</div>

				<div className="border-espresso-line/70 mt-5 overflow-hidden rounded-xl border">
					<div className="bg-espresso-raised/60 flex items-center justify-between px-4 py-3">
						<p className="font-serif text-xl">Out</p>
						<span className="border-copper/60 text-copper flex size-6 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
							2
						</span>
					</div>
					{['limes', 'white miso'].map((name) => (
						<div
							key={name}
							className="border-espresso-line/60 flex items-center gap-3 border-t px-4 py-3"
						>
							<span className="bg-copper size-2 rounded-full" />
							<span className="flex-1 text-[15px]">{name}</span>
							<span className="border-espresso-line/70 bg-espresso-raised inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium">
								Back in
							</span>
						</div>
					))}
				</div>

				<div className="mt-6 flex items-baseline justify-between">
					<p className="font-serif text-xl">Usually available</p>
					<p className="text-cream-muted text-sm tabular-nums">31</p>
				</div>
				<div className="border-espresso-line/60 divide-espresso-line/60 mt-2 divide-y border-t">
					{staples.map((name) => (
						<div key={name} className="flex items-center gap-3 py-2.5">
							<span className="bg-cream-muted/40 size-2 rounded-full" />
							<span className="flex-1 text-[15px]">{name}</span>
							<span className="border-espresso-line/70 inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium">
								Out
							</span>
							<span className="text-cream-muted flex size-8 items-center justify-center">
								<Icon name="trash" size="sm" />
							</span>
						</div>
					))}
				</div>
			</div>
		</AppScreen>
	)
}

const shoppingNext = [
	{ name: 'Salmon fillets', amount: '4 fillets' },
	{ name: 'Limes', amount: '3 · incl. meals' },
	{ name: 'White miso', amount: '1 tub' },
	{ name: 'Black beans', amount: '2 cans' },
	{ name: 'Corn tortillas', amount: '12' },
	{ name: 'Feta', amount: '200 g' },
	{ name: 'Whole chicken', amount: '1 · about 1.8 kg' },
	{ name: 'Spaghetti', amount: '500 g', checked: true },
	{ name: 'Parmesan', amount: '1 wedge', checked: true },
]

function ShoppingRow({
	name,
	amount,
	checked,
}: {
	name: string
	amount?: string
	checked?: boolean
}) {
	return (
		<div className="flex items-center gap-3 py-2.5">
			<span
				className={cn(
					'flex size-6 shrink-0 items-center justify-center rounded border-2',
					checked
						? 'border-sage bg-sage text-sage-foreground'
						: 'border-espresso-line bg-espresso-raised/40',
				)}
			>
				{checked ? <Icon name="check" size="xs" /> : null}
			</span>
			<div className="min-w-0 flex-1">
				<p
					className={cn(
						'text-base',
						checked && 'text-cream-muted line-through',
					)}
				>
					{name}
				</p>
				{amount ? <p className="text-cream-muted text-sm">{amount}</p> : null}
			</div>
			<span className="text-cream-muted/50 flex size-10 items-center justify-center">
				<Icon name="dots-horizontal" size="sm" />
			</span>
		</div>
	)
}

function ShoppingScreen() {
	const checked = shoppingNext.filter((item) => item.checked).length
	return (
		<AppScreen label="The Shopping page: 2 of 9 items checked for Next shop">
			<div className="border-espresso-line/70 border-b px-5 py-4 sm:px-6">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<h3 className="font-serif text-2xl">
						Shopping List{' '}
						<span className="text-cream-muted font-humanist text-lg tabular-nums">
							({checked}/{shoppingNext.length})
						</span>
					</h3>
					<div className="flex items-center gap-2 sm:ml-auto">
						<span className="border-espresso-line/70 inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium">
							<Icon name="plus" size="sm" />
							Staples
						</span>
						<span className="border-espresso-line/70 inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium">
							<Icon name="calendar" size="sm" />
							From Plan
						</span>
					</div>
				</div>
			</div>
			<div className="px-5 py-4 sm:px-6">
				<p className="text-cream-muted pb-1 text-sm">
					Generated for Sep 21 – 27 · 6 usually on hand
				</p>
				<div className="divide-espresso-line/60 divide-y">
					{shoppingNext.map((item) => (
						<ShoppingRow key={item.name} {...item} />
					))}
				</div>
				<div className="border-espresso-line/60 mt-6 border-t pt-3">
					<p className="font-serif text-lg">Later</p>
					<div className="divide-espresso-line/60 divide-y">
						<ShoppingRow name="Sesame oil" amount="small bottle" />
					</div>
				</div>
			</div>
		</AppScreen>
	)
}
