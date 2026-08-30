import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { data, Form, Link, redirect, useNavigation } from 'react-router'
import { RecipeThumb } from '#app/components/recipe-selector.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	getWeekStart,
	MEAL_TYPES,
	MEAL_TYPE_LABELS,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { PlanMenuSchema } from '#app/utils/meal-plan-validation.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { createMealWithItems } from '#app/utils/meal.server.ts'
import {
	menuToSnapshotSections,
	snapshotHasContent,
} from '#app/utils/menu-snapshot.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { servingInstantFromWallTime } from '#app/utils/serving-time.ts'
import {
	formatTargetYieldAmount,
	getTypedYield,
	scaleMultiplierToTargetYield,
} from '#app/utils/target-yield.ts'
import { type Route } from './+types/$menuId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
	const title = loaderData?.menu?.title
		? `${loaderData.menu.title} | Quartermaster`
		: 'Menu | Quartermaster'
	return [{ title }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
			householdId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							kind: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
							recipe: {
								select: {
									id: true,
									title: true,
									householdId: true,
									yieldAmount: true,
									yieldLabel: true,
									image: { select: { objectKey: true } },
								},
							},
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: {
									id: true,
									name: true,
									quantity: true,
									unit: true,
								},
							},
						},
					},
				},
			},
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	return {
		menu: {
			...menu,
			sections: menu.sections.map((section) => ({
				...section,
				items: section.items.map((item) => {
					// A reference that no longer resolves to a household Recipe reads
					// as a clearly missing card with its frozen identity.
					const recipe =
						item.recipe && item.recipe.householdId === householdId
							? {
									id: item.recipe.id,
									title: item.recipe.title,
									yieldAmount: item.recipe.yieldAmount,
									yieldLabel: item.recipe.yieldLabel,
									image: item.recipe.image,
								}
							: null
					return {
						id: item.id,
						kind: item.kind,
						recipeTitle: item.recipeTitle,
						scaleMultiplier: item.scaleMultiplier,
						note: item.note,
						recipe,
						shoppingLines: item.shoppingLines,
					}
				}),
			})),
		},
	}
}

/**
 * Add to Plan (#107): copy this Menu into ONE stable Meal snapshot — section
 * order, Recipe/note cards, display identity, multipliers, display notes, and
 * note Shopping lines all frozen by value. Later Menu edits never mutate the
 * Meal; sourceMenuId + the Menu's updatedAt are retained as the revision a
 * future explicit Update-from-Menu action (not shipped here) can compare.
 */
export async function action({ request, params }: Route.ActionArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	invariantResponse(
		formData.get('intent') === 'planMenu',
		'Unsupported action',
		{
			status: 400,
		},
	)

	const submission = parseWithZod(formData, { schema: PlanMenuSchema })
	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}
	const { date, label, time, timeZone, guestCount } = submission.value

	// Fresh household-scoped read at submit time — the snapshot freezes what
	// the Menu holds now, and updatedAt is read in the same query it copies.
	const menu = await prisma.menu.findFirst({
		where: { id: params.menuId, householdId },
		select: {
			id: true,
			updatedAt: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							kind: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
							recipe: {
								select: { id: true, title: true, householdId: true },
							},
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: { name: true, quantity: true, unit: true },
							},
						},
					},
				},
			},
		},
	})
	invariantResponse(menu, 'Menu not found', { status: 404 })
	const sections = menuToSnapshotSections(menu, householdId)
	if (!snapshotHasContent(sections)) {
		return data(
			{
				result: submission.reply({
					formErrors: [
						'This menu has nothing to plan yet — add a recipe or note first.',
					],
				}),
			},
			{ status: 400 },
		)
	}

	const mealPlan = await ensureMealPlan(prisma, {
		householdId,
		weekStart: getWeekStart(date),
	})
	// Serving time is one UTC instant plus its originating IANA zone, computed
	// from the Meal's semantic date (#98). Guest count travels as context only.
	const servingAt =
		time != null ? servingInstantFromWallTime(date, time, timeZone!) : null
	await createMealWithItems(prisma, {
		mealPlanId: mealPlan.id,
		date,
		label: label ?? null,
		servingAt,
		servingTimeZone: servingAt ? (timeZone ?? null) : null,
		guestCount: guestCount ?? null,
		sourceMenuId: menu.id,
		sourceMenuRevision: menu.updatedAt,
		items: [],
		sections,
	})

	return redirect(`/plan?weekStart=${serializeDate(getWeekStart(date))}`)
}

/** Local calendar date — the same "today" convention the planner uses. */
function todayLocalDateString() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * The Add to Plan panel (#107): date plus optional label, serving time, and
 * guest count. Guest count is prefilled from the Menu's default as context —
 * it never scales quantities; multipliers copy unchanged.
 */
function AddToPlanPanel({
	defaultGuestCount,
	errors,
	onCancel,
}: {
	defaultGuestCount: number | null
	errors: string[]
	onCancel: () => void
}) {
	// The instant is named by wall time plus the browser's IANA zone; the zone
	// travels in a hidden input so the server can store the pair (#98).
	const [timeZone] = useState(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
	)
	const [defaultDate] = useState(todayLocalDateString)
	// Full-page POST with no server-side dedupe — a double-click would plan
	// the Menu twice, so the submit locks while the navigation is in flight.
	const navigation = useNavigation()
	const submitting = navigation.state !== 'idle'

	return (
		<Form
			method="POST"
			className="border-border/60 bg-card mt-4 rounded-lg border p-4"
		>
			<input type="hidden" name="intent" value="planMenu" />
			<input type="hidden" name="timeZone" value={timeZone} />
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div className="col-span-2 sm:col-span-1">
					<label
						htmlFor="plan-date"
						className="text-muted-foreground mb-1 block text-xs font-medium"
					>
						Date
					</label>
					<Input
						id="plan-date"
						type="date"
						name="date"
						required
						defaultValue={defaultDate}
						className="h-9"
					/>
				</div>
				<div>
					<label
						htmlFor="plan-label"
						className="text-muted-foreground mb-1 block text-xs font-medium"
					>
						Label
					</label>
					<select
						id="plan-label"
						name="label"
						defaultValue=""
						className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
					>
						<option value="">No label</option>
						{MEAL_TYPES.map((type) => (
							<option key={type} value={type}>
								{MEAL_TYPE_LABELS[type]}
							</option>
						))}
					</select>
				</div>
				<div>
					<label
						htmlFor="plan-time"
						className="text-muted-foreground mb-1 block text-xs font-medium"
					>
						Serving time
					</label>
					<Input id="plan-time" type="time" name="time" className="h-9" />
				</div>
				<div>
					<label
						htmlFor="plan-guests"
						className="text-muted-foreground mb-1 block text-xs font-medium"
					>
						Guests
					</label>
					<Input
						id="plan-guests"
						type="number"
						name="guestCount"
						min={1}
						max={999}
						defaultValue={defaultGuestCount ?? ''}
						className="h-9"
					/>
				</div>
			</div>
			<p className="text-muted-foreground mt-2 text-xs">
				Recipe multipliers copy from this Menu and remain manually editable in
				Plan.
			</p>
			{errors.length > 0 ? (
				<ul className="text-destructive mt-2 space-y-0.5 text-sm">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			) : null}
			<div className="mt-3 flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={submitting}>
					<Icon name="calendar" size="sm" />
					{submitting ? 'Adding…' : 'Add to Plan'}
				</Button>
			</div>
		</Form>
	)
}

export default function MenuDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { menu } = loaderData
	const [planning, setPlanning] = useState(false)
	const [planFormDismissed, setPlanFormDismissed] = useState(false)
	const planResult =
		actionData != null && 'result' in actionData ? actionData.result : undefined
	// A failed full-page POST re-renders with actionData — keep the panel open
	// so its errors are visible, until the user cancels.
	const showPlanPanel = planning || (planResult != null && !planFormDismissed)
	const planErrors = planResult?.error
		? [
				...new Set(
					Object.values(planResult.error)
						.flat()
						.filter(
							(error): error is string =>
								typeof error === 'string' && Boolean(error),
						),
				),
			]
		: []
	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<Link
				to="/recipes/menus"
				viewTransition
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition-colors"
			>
				<Icon name="arrow-left" size="sm" />
				Menus
			</Link>

			<div className="flex items-start justify-between gap-3">
				<h1 className="font-serif text-2xl font-normal">{menu.title}</h1>
				<div className="flex shrink-0 flex-wrap justify-end gap-2">
					<Button asChild variant="outline">
						<Link to={`/recipes/menus/${menu.id}/edit`}>
							<Icon name="pencil-1" size="sm" />
							Edit
						</Link>
					</Button>
					{!showPlanPanel && (
						<Button
							onClick={() => {
								setPlanning(true)
								setPlanFormDismissed(false)
							}}
						>
							<Icon name="calendar" size="sm" />
							Add to Plan
						</Button>
					)}
				</div>
			</div>

			{menu.defaultGuestCount ? (
				<p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
					<Icon name="avatar" size="xs" />
					Usually for {menu.defaultGuestCount} guests
				</p>
			) : null}

			{menu.description && (
				<p className="text-muted-foreground mt-3 leading-relaxed">
					{menu.description}
				</p>
			)}

			{showPlanPanel && (
				<AddToPlanPanel
					defaultGuestCount={menu.defaultGuestCount}
					errors={planErrors}
					onCancel={() => {
						setPlanning(false)
						setPlanFormDismissed(true)
					}}
				/>
			)}

			<div className="mt-8 space-y-8">
				{menu.sections
					// An empty unnamed section stays quietly out of the way once
					// named sections carry the menu.
					.filter(
						(section) =>
							section.name !== null ||
							section.items.length > 0 ||
							menu.sections.length === 1,
					)
					.map((section) => (
						<section key={section.id}>
							{/* The unnamed section stays headingless */}
							{section.name ? (
								<h2 className={`${sectionLabelClass} mb-3`}>{section.name}</h2>
							) : null}
							{section.items.length === 0 ? (
								section.name ? (
									<p className="text-muted-foreground text-sm">
										Nothing in this section yet.
									</p>
								) : (
									<p className="text-muted-foreground border-border/60 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm">
										Nothing on this menu yet.
									</p>
								)
							) : (
								<ul className="space-y-2">
									{section.items.map((item) =>
										item.kind === 'note' ? (
											<MenuNoteCard key={item.id} item={item} />
										) : (
											<MenuRecipeCard key={item.id} item={item} />
										),
									)}
								</ul>
							)}
						</section>
					))}
			</div>
		</div>
	)
}

type MenuDetailItem = {
	id: string
	kind: string
	recipeTitle: string | null
	scaleMultiplier: number | null
	note: string | null
	recipe: {
		id: string
		title: string
		yieldAmount: number | null
		yieldLabel: string | null
		image: { objectKey: string } | null
	} | null
	shoppingLines: Array<{
		id: string
		name: string
		quantity: string | null
		unit: string | null
	}>
}

/**
 * A flexible note card — drinks, shared prep, serving reminders — with its
 * ordinary Shopping lines listed underneath (#102).
 */
function MenuNoteCard({ item }: { item: MenuDetailItem }) {
	return (
		<li className="border-border/60 bg-card flex items-start gap-3 rounded-lg border p-3">
			<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
				<Icon name="pencil-2" className="text-muted-foreground size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="min-w-0 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
					{item.note}
				</p>
				{item.shoppingLines.length > 0 ? (
					<ul className="mt-2 space-y-1">
						{item.shoppingLines.map((line) => (
							<li
								key={line.id}
								className="text-muted-foreground flex items-baseline gap-1.5 text-sm"
							>
								<Icon name="cart" size="xs" className="translate-y-px" />
								<span className="min-w-0 break-words">{line.name}</span>
								{line.quantity || line.unit ? (
									<span className="shrink-0 tabular-nums">
										{[line.quantity, line.unit].filter(Boolean).join(' ')}
									</span>
								) : null}
							</li>
						))}
					</ul>
				) : null}
			</div>
		</li>
	)
}

function MenuRecipeCard({ item }: { item: MenuDetailItem }) {
	const title = item.recipe?.title ?? item.recipeTitle ?? 'Recipe'
	const recipeYield = item.recipe ? getTypedYield(item.recipe) : null
	const targetYield =
		item.scaleMultiplier != null
			? scaleMultiplierToTargetYield(item.scaleMultiplier, recipeYield)
			: null
	// Multiplier remains the shared quantity vocabulary. Explicit yield only
	// adds a friendly derived output after it.
	const quantity =
		item.scaleMultiplier != null && recipeYield && targetYield != null
			? `${formatScaleMultiplier(item.scaleMultiplier)}× · makes ${formatTargetYieldAmount(targetYield)} ${recipeYield.label}`
			: item.scaleMultiplier != null && item.scaleMultiplier !== 1
				? `${formatScaleMultiplier(item.scaleMultiplier)}×`
				: null

	const content = (
		<>
			{item.recipe ? (
				<RecipeThumb title={title} image={item.recipe.image} />
			) : (
				<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
					<Icon
						name="question-mark-circled"
						className="text-muted-foreground size-4"
					/>
				</span>
			)}
			<div className="min-w-0 flex-1">
				<p className="line-clamp-2 min-w-0 font-serif text-[17px] leading-[1.4] break-words md:text-base">
					{title}
				</p>
				{item.recipe ? null : (
					<p className="text-destructive mt-0.5 text-xs">
						No longer in your recipe library — edit the menu to replace or
						remove it
					</p>
				)}
				{item.note ? (
					<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
						{item.note}
					</p>
				) : null}
			</div>
			{quantity ? (
				<span className="text-muted-foreground shrink-0 text-sm font-medium tabular-nums">
					{quantity}
				</span>
			) : null}
		</>
	)

	if (item.recipe) {
		return (
			<li>
				<Link
					to={`/recipes/${item.recipe.id}`}
					className="border-border/60 bg-card hover:bg-muted/40 flex items-center gap-3 rounded-lg border p-3 transition-colors"
				>
					{content}
				</Link>
			</li>
		)
	}
	return (
		<li className="border-border/60 bg-muted/30 flex items-center gap-3 rounded-lg border border-dashed p-3">
			{content}
		</li>
	)
}
