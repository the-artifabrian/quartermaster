import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useRef, useState } from 'react'
import {
	data,
	Form,
	Link,
	redirect,
	useFetcher,
	useNavigation,
	useSubmit,
} from 'react-router'
import {
	MealQuantityClarification,
	MealQuantityReview,
	type QuantityReviewItem,
} from '#app/components/meal-quantity-review.tsx'
import { RecipeThumb } from '#app/components/recipe-selector.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	checkAndRecordAiUsage,
	getAiUsageRemaining,
} from '#app/utils/ai-rate-limit.server.ts'
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
import {
	DAILY_QUANTITY_PROPOSAL_LIMIT,
	parseQuantitySelections,
	proposeContextualMealQuantities,
	type QuantityPlanningInput,
	type QuantityClarification,
	type QuantityProposal,
	type QuantitySelection,
} from '#app/utils/meal-quantity-proposal.server.ts'
import { createMealWithItems } from '#app/utils/meal.server.ts'
import {
	menuToSnapshotSections,
	snapshotHasContent,
} from '#app/utils/menu-snapshot.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { servingInstantFromWallTime } from '#app/utils/serving-time.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
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
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'updateMenuQuantityDefaults') {
		const selections = parseQuantitySelections(
			formData.get('quantitySelections'),
		)
		if (!selections.ok) {
			return data(
				{ status: 'error' as const, quantityError: selections.error },
				{ status: 400 },
			)
		}
		const selectedKeys = selections.data.map((selection) => selection.itemKey)
		const ownedItems = await prisma.menuItem.findMany({
			where: {
				id: { in: selectedKeys },
				kind: 'recipe',
				recipeId: { not: null },
				section: { menuId: params.menuId, menu: { householdId } },
			},
			select: { id: true },
		})
		invariantResponse(
			ownedItems.length === selectedKeys.length,
			'One or more Recipe items no longer belong to this Menu',
			{ status: 400 },
		)
		await prisma.$transaction([
			prisma.menu.update({
				where: { id: params.menuId },
				data: { updatedAt: new Date() },
			}),
			...selections.data.map((selection) =>
				prisma.menuItem.update({
					where: { id: selection.itemKey },
					data: { scaleMultiplier: selection.scaleMultiplier },
				}),
			),
		])
		return data({
			status: 'success' as const,
			menuDefaultsUpdated: selections.data.length,
		})
	}

	if (intent === 'proposeMenuQuantities') {
		const { isProActive } = await getUserTier(userId)
		if (!isProActive) {
			return data({
				status: 'error' as const,
				quantityError:
					'Plan quantities requires Pro. Menu multipliers and manual planning are unchanged.',
				requiresPro: true as const,
			})
		}

		const rawGuestCount = formData.get('guestCount')
		const guestCount =
			typeof rawGuestCount === 'string' ? Number(rawGuestCount) : Number.NaN
		if (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 999) {
			return data(
				{
					status: 'error' as const,
					quantityError:
						'Add a valid guest count before planning quantities. Menu multipliers are unchanged.',
				},
				{ status: 400 },
			)
		}

		const planningInput = await loadMenuQuantityPlanningInput({
			menuId: params.menuId,
			householdId,
			guestCount,
		})
		if ('error' in planningInput) {
			return data(
				{ status: 'error' as const, quantityError: planningInput.error },
				{ status: 400 },
			)
		}

		const clarificationRound = formData.get('clarificationRound')
		let clarification: { question: string; answer: string } | undefined
		if (clarificationRound != null) {
			if (clarificationRound !== '1') {
				return data(
					{
						status: 'error' as const,
						quantityError:
							'Plan quantities allows one clarification only. Menu multipliers are unchanged.',
					},
					{ status: 400 },
				)
			}
			const question = formData.get('clarificationQuestion')
			const answer = formData.get('clarificationAnswer')
			if (
				typeof question !== 'string' ||
				typeof answer !== 'string' ||
				!question.trim() ||
				!answer.trim()
			) {
				return data(
					{
						status: 'error' as const,
						quantityError:
							'Choose or enter one clarification answer. Menu multipliers are unchanged.',
					},
					{ status: 400 },
				)
			}
			clarification = {
				question: question.trim().slice(0, 240),
				answer: answer.trim().slice(0, 240),
			}
		}

		const remaining = await getAiUsageRemaining(
			userId,
			'meal_quantity_proposal_llm_call',
			DAILY_QUANTITY_PROPOSAL_LIMIT,
		)
		if (remaining <= 0) {
			return data(
				{
					status: 'error' as const,
					quantityError: `You've reached the daily limit of ${DAILY_QUANTITY_PROPOSAL_LIMIT} quantity-planning calls. Menu multipliers are unchanged.`,
				},
				{ status: 429 },
			)
		}

		const outcome = await proposeContextualMealQuantities(planningInput, {
			clarification,
		})
		if (!outcome.ok) {
			return data({ status: 'error' as const, quantityError: outcome.error })
		}
		await checkAndRecordAiUsage(
			userId,
			'meal_quantity_proposal_llm_call',
			DAILY_QUANTITY_PROPOSAL_LIMIT,
		)
		return data({
			status: 'success' as const,
			quantityProposal: outcome.data,
		})
	}

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
							id: true,
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
	let multiplierOverrides: Map<string, number> | undefined
	if (formData.has('quantitySelections')) {
		const selections = parseQuantitySelections(
			formData.get('quantitySelections'),
		)
		if (!selections.ok) {
			return data(
				{
					result: submission.reply({ formErrors: [selections.error] }),
				},
				{ status: 400 },
			)
		}
		const availableKeys = new Set(
			menu.sections.flatMap((section) =>
				section.items.flatMap((item) =>
					item.kind === 'recipe' && item.recipe != null ? [item.id] : [],
				),
			),
		)
		invariantResponse(
			selections.data.every((selection) =>
				availableKeys.has(selection.itemKey),
			),
			'One or more Recipe items no longer belong to this Menu',
			{ status: 400 },
		)
		multiplierOverrides = new Map(
			selections.data.map((selection) => [
				selection.itemKey,
				selection.scaleMultiplier,
			]),
		)
	}

	const sections = menuToSnapshotSections(
		menu,
		householdId,
		multiplierOverrides,
	)
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

async function loadMenuQuantityPlanningInput({
	menuId,
	householdId,
	guestCount,
}: {
	menuId: string
	householdId: string
	guestCount: number
}): Promise<QuantityPlanningInput | { error: string }> {
	const menu = await prisma.menu.findFirst({
		where: { id: menuId, householdId },
		select: {
			sections: {
				orderBy: [{ order: 'asc' }, { id: 'asc' }],
				select: {
					name: true,
					items: {
						orderBy: [{ order: 'asc' }, { id: 'asc' }],
						select: {
							id: true,
							kind: true,
							note: true,
							scaleMultiplier: true,
							recipe: {
								select: {
									title: true,
									description: true,
									ingredients: {
										orderBy: [{ order: 'asc' }, { id: 'asc' }],
										select: {
											name: true,
											amount: true,
											unit: true,
											notes: true,
											isHeading: true,
										},
									},
									instructions: {
										orderBy: [{ order: 'asc' }, { id: 'asc' }],
										select: { content: true },
									},
								},
							},
						},
					},
				},
			},
		},
	})
	invariantResponse(menu, 'Menu not found', { status: 404 })

	const recipeItems = menu.sections.flatMap((section) =>
		section.items.filter((item) => item.kind === 'recipe'),
	)
	if (recipeItems.some((item) => item.recipe == null)) {
		return {
			error:
				'Replace or remove missing Recipe cards before planning quantities. Menu multipliers are unchanged.',
		}
	}
	if (recipeItems.length === 0) {
		return {
			error:
				'This Menu has no available Recipes to plan. Menu multipliers are unchanged.',
		}
	}

	return {
		context: 'menu-draft',
		guestCount,
		sections: menu.sections.map((section) => ({
			name: section.name,
			items: section.items.flatMap<
				QuantityPlanningInput['sections'][number]['items'][number]
			>((item) => {
				if (item.kind === 'note') {
					return item.note?.trim() ? [{ kind: 'note', text: item.note }] : []
				}
				return [
					{
						kind: 'recipe',
						itemKey: item.id,
						recipe: {
							title: item.recipe!.title,
							description: item.recipe!.description,
							note: item.note,
							currentScaleMultiplier: item.scaleMultiplier ?? 1,
							ingredients: item.recipe!.ingredients,
							instructions: item.recipe!.instructions,
						},
					},
				]
			}),
		})),
	}
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
	quantityItems,
	errors,
	onCancel,
}: {
	defaultGuestCount: number | null
	quantityItems: QuantityReviewItem[]
	errors: string[]
	onCancel: () => void
}) {
	// The instant is named by wall time plus the browser's IANA zone; the zone
	// travels in a hidden input so the server can store the pair (#98).
	const [timeZone] = useState(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
	)
	const [defaultDate] = useState(todayLocalDateString)
	const formRef = useRef<HTMLFormElement>(null)
	const submit = useSubmit()
	const quantityFetcher = useFetcher<{
		status: 'success' | 'error'
		quantityError?: string
		quantityProposal?: QuantityProposal | QuantityClarification
	}>()
	const updateDefaultsFetcher = useFetcher<{
		status: 'success' | 'error'
		quantityError?: string
		menuDefaultsUpdated?: number
	}>()
	const [showQuantityReview, setShowQuantityReview] = useState(false)
	// Full-page POST with no server-side dedupe — a double-click would plan
	// the Menu twice, so the submit locks while the navigation is in flight.
	const navigation = useNavigation()
	const submitting = navigation.state !== 'idle'

	function requestQuantityProposal(clarification?: {
		question: string
		answer: string
	}) {
		const form = formRef.current
		if (!form || !form.reportValidity()) return
		const proposalData = new FormData(form)
		proposalData.set('intent', 'proposeMenuQuantities')
		if (clarification) {
			proposalData.set('clarificationRound', '1')
			proposalData.set('clarificationQuestion', clarification.question)
			proposalData.set('clarificationAnswer', clarification.answer)
		}
		setShowQuantityReview(true)
		void quantityFetcher.submit(proposalData, { method: 'POST' })
	}

	function applyAndPlan(selections: QuantitySelection[]) {
		const form = formRef.current
		if (!form || !form.reportValidity()) return
		const planData = new FormData(form)
		planData.set('intent', 'planMenu')
		planData.set('quantitySelections', JSON.stringify(selections))
		void submit(planData, { method: 'POST' })
	}

	function updateMenuDefaults(selections: QuantitySelection[]) {
		void updateDefaultsFetcher.submit(
			{
				intent: 'updateMenuQuantityDefaults',
				quantitySelections: JSON.stringify(selections),
			},
			{ method: 'POST' },
		)
	}

	const quantityProposal = quantityFetcher.data?.quantityProposal
	const quantityBusy =
		quantityFetcher.state !== 'idle' ||
		updateDefaultsFetcher.state !== 'idle' ||
		submitting
	const quantityReviewVisible = showQuantityReview && quantityProposal != null

	return (
		<Form
			ref={formRef}
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
				Quantities copy from the Menu as they are unless you explicitly review
				and apply a proposal to this new Meal.
			</p>
			{quantityItems.length > 0 && !quantityReviewVisible ? (
				<div className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
					<div>
						<p className="text-sm font-medium">Need help with quantities?</p>
						<p className="text-muted-foreground text-xs">
							Proposes Recipe batch multipliers for this guest count.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={quantityBusy}
						onClick={() => requestQuantityProposal()}
					>
						<Icon
							name="sparkles"
							className={
								quantityFetcher.state !== 'idle' ? 'animate-pulse' : ''
							}
						/>
						{quantityFetcher.state !== 'idle' ? 'Planning…' : 'Plan quantities'}
					</Button>
				</div>
			) : null}

			{showQuantityReview && quantityFetcher.data?.status === 'error' ? (
				<div className="mt-3 rounded-md border p-3">
					<p className="text-destructive text-sm">
						{quantityFetcher.data.quantityError}
					</p>
					<p className="text-muted-foreground mt-1 text-xs">
						You can still add the Menu with its unchanged manual multipliers.
					</p>
				</div>
			) : null}

			{showQuantityReview && quantityProposal?.status === 'clarification' ? (
				<div className="mt-3 rounded-md border p-3">
					<MealQuantityClarification
						clarification={quantityProposal}
						busy={quantityBusy}
						onCancel={() => setShowQuantityReview(false)}
						onAnswer={(answer) =>
							requestQuantityProposal({
								question: quantityProposal.question,
								answer,
							})
						}
					/>
				</div>
			) : null}

			{showQuantityReview && quantityProposal?.status === 'proposal' ? (
				<div className="mt-3 rounded-md border p-3">
					{updateDefaultsFetcher.data?.status === 'success' ? (
						<p className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">
							Updated {updateDefaultsFetcher.data.menuDefaultsUpdated ?? 0} Menu{' '}
							default
							{updateDefaultsFetcher.data.menuDefaultsUpdated === 1 ? '' : 's'}.
							No Meal is created or changed until you apply it.
						</p>
					) : updateDefaultsFetcher.data?.status === 'error' ? (
						<p className="text-destructive mb-3 text-sm">
							{updateDefaultsFetcher.data.quantityError}
						</p>
					) : null}
					<MealQuantityReview
						proposal={quantityProposal}
						items={quantityItems}
						busy={quantityBusy}
						applyLabel="Apply selected & add to Plan"
						onApply={applyAndPlan}
						onUpdateDefaults={updateMenuDefaults}
						onRerun={() => requestQuantityProposal()}
						onCancel={() => setShowQuantityReview(false)}
					/>
				</div>
			) : null}
			{errors.length > 0 ? (
				<ul className="text-destructive mt-2 space-y-0.5 text-sm">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			) : null}
			<div
				className={`mt-3 justify-end gap-2 ${quantityReviewVisible ? 'hidden' : 'flex'}`}
			>
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
	const quantityItems: QuantityReviewItem[] = menu.sections.flatMap((section) =>
		section.items.flatMap((item) =>
			item.kind === 'recipe' && item.recipe
				? [
						{
							itemKey: item.id,
							title: item.recipe.title,
							currentScaleMultiplier: item.scaleMultiplier ?? 1,
						},
					]
				: [],
		),
	)

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
					quantityItems={quantityItems}
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
	// "1×" is the default batch — only a real adjustment earns a badge.
	const multiplier =
		item.scaleMultiplier != null && item.scaleMultiplier !== 1
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
			{multiplier ? (
				<span className="text-muted-foreground shrink-0 text-sm font-medium tabular-nums">
					{multiplier}
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
