import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import {
	checkAndRecordAiUsage,
	getAiUsageRemaining,
} from '#app/utils/ai-rate-limit.server.ts'
import { getWeekStart } from '#app/utils/date.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	AddMealSchema,
	AddTextMealSchema,
	MealDetailsSchema,
} from '#app/utils/meal-plan-validation.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import {
	DAILY_QUANTITY_PROPOSAL_LIMIT,
	parseQuantitySelections,
	proposeContextualMealQuantities,
	type QuantityPlanningInput,
} from '#app/utils/meal-quantity-proposal.server.ts'
import {
	addRecipeToMeal,
	createMealWithItems,
	createRecipeMeal,
	moveMealInDay,
	removeMeal,
	removeRecipeItem,
	setItemCooked,
	setItemMultiplier,
	setMealCooked,
} from '#app/utils/meal.server.ts'
import { ScaleMultiplierSchema } from '#app/utils/menu-validation.ts'
import { servingInstantFromWallTime } from '#app/utils/serving-time.ts'
import {
	reconcileMealShoppingContributions,
	removeMealWithShoppingContributions,
	replaceMealShoppingContributions,
} from '#app/utils/shopping-contribution.server.ts'
import { buildShoppingDemand } from '#app/utils/shopping-demand.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { annotateInventoryMatches } from '#app/utils/shopping-list.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'

type PlanActionUser = Pick<
	Awaited<ReturnType<typeof requireUserWithTier>>,
	'userId' | 'householdId'
> & { isProActive?: boolean }

type QuantityProposalDependencies = {
	propose: typeof proposeContextualMealQuantities
	usageRemaining: typeof getAiUsageRemaining
	recordUsage: typeof checkAndRecordAiUsage
}

const quantityProposalDependencies: QuantityProposalDependencies = {
	propose: proposeContextualMealQuantities,
	usageRemaining: getAiUsageRemaining,
	recordUsage: checkAndRecordAiUsage,
}

export function createPlanAction(
	db: PrismaClient,
	requirePlanUser: (
		request: Request,
	) => Promise<PlanActionUser> = requireUserWithTier,
	quantityDependencies: QuantityProposalDependencies = quantityProposalDependencies,
) {
	return async function planAction({ request }: { request: Request }) {
		const { userId, householdId, isProActive } = await requirePlanUser(request)
		const formData = await request.formData()
		const intent = formData.get('intent')

		// Every id submitted by the client is re-resolved through the household
		// before any write — other-household Meals, items, and Recipes 404.
		async function requireMeal(mealId: unknown) {
			invariantResponse(typeof mealId === 'string', 'Meal ID is required')
			const meal = await db.meal.findFirst({
				where: { id: mealId, mealPlan: { householdId } },
			})
			invariantResponse(meal, 'Meal not found', { status: 404 })
			return meal
		}
		async function requireItem(itemId: unknown) {
			invariantResponse(typeof itemId === 'string', 'Item ID is required')
			const item = await db.mealRecipeItem.findFirst({
				where: { id: itemId, meal: { mealPlan: { householdId } } },
			})
			invariantResponse(item, 'Item not found', { status: 404 })
			return item
		}
		async function requireRecipe(recipeId: string) {
			const recipe = await db.recipe.findFirst({
				where: { id: recipeId, householdId },
				select: { id: true, title: true, servings: true },
			})
			invariantResponse(recipe, 'Recipe not found', { status: 404 })
			return recipe
		}

		// The one-Recipe fast path: date + Recipe (+ optional label/multiplier)
		// becomes a new ordered Meal.
		if (intent === 'addMeal') {
			const submission = parseWithZod(formData, { schema: AddMealSchema })
			if (submission.status !== 'success') {
				return { status: 'error' as const, submission: submission.reply() }
			}
			const { date, recipeId, label, multiplier } = submission.value
			const recipe = await requireRecipe(recipeId)
			const mealPlan = await ensureMealPlan(db, {
				householdId,
				weekStart: getWeekStart(date),
			})
			await createRecipeMeal(db, {
				mealPlanId: mealPlan.id,
				date,
				label: label ?? null,
				recipe,
				scaleMultiplier: multiplier ?? 1,
			})
			return { status: 'success' as const }
		}

		if (intent === 'addTextMeal') {
			const submission = parseWithZod(formData, { schema: AddTextMealSchema })
			if (submission.status !== 'success') {
				return { status: 'error' as const, submission: submission.reply() }
			}
			const { date, label, text } = submission.value
			const mealPlan = await ensureMealPlan(db, {
				householdId,
				weekStart: getWeekStart(date),
			})
			await createMealWithItems(db, {
				mealPlanId: mealPlan.id,
				date,
				label: label ?? null,
				genericText: text,
				items: [],
			})
			return { status: 'success' as const }
		}

		if (intent === 'addRecipeToMeal') {
			const meal = await requireMeal(formData.get('mealId'))
			invariantResponse(meal.genericText == null, 'Meal is text-only', {
				status: 400,
			})
			const recipeId = formData.get('recipeId')
			invariantResponse(typeof recipeId === 'string', 'Recipe ID is required')
			const recipe = await requireRecipe(recipeId)
			await addRecipeToMeal(db, { meal, recipe })
			return { status: 'success' as const }
		}

		if (intent === 'setItemCooked') {
			const item = await requireItem(formData.get('itemId'))
			// The form submits the target state rather than asking the server to
			// flip, so duplicate/rapid submissions are idempotent (last write wins).
			const cooked = formData.get('cooked') === 'true'
			await setItemCooked(db, { itemId: item.id, cooked })
			return { status: 'success' as const }
		}

		if (intent === 'setMealCooked') {
			const meal = await requireMeal(formData.get('mealId'))
			const cooked = formData.get('cooked') === 'true'
			await setMealCooked(db, { meal, cooked })
			return { status: 'success' as const }
		}

		if (intent === 'setItemMultiplier') {
			const item = await requireItem(formData.get('itemId'))
			const parsed = ScaleMultiplierSchema.safeParse(formData.get('multiplier'))
			if (!parsed.success) {
				return {
					status: 'error' as const,
					multiplierError: parsed.error.issues[0]?.message ?? 'Invalid value',
				}
			}
			await setItemMultiplier(db, {
				itemId: item.id,
				scaleMultiplier: parsed.data,
			})
			return { status: 'success' as const }
		}

		if (intent === 'proposeMealQuantities') {
			const meal = await requireMeal(formData.get('mealId'))
			if (!isProActive) {
				return {
					status: 'error' as const,
					quantityError:
						'Plan quantities requires Pro. Manual multipliers remain fully editable.',
					requiresPro: true as const,
				}
			}

			const planningInput = await loadMealQuantityPlanningInput(db, {
				mealId: meal.id,
				householdId,
			})
			if ('error' in planningInput) {
				return { status: 'error' as const, quantityError: planningInput.error }
			}

			const clarificationRound = formData.get('clarificationRound')
			let clarification: { question: string; answer: string } | undefined
			if (clarificationRound != null) {
				if (clarificationRound !== '1') {
					return {
						status: 'error' as const,
						quantityError:
							'Plan quantities allows one clarification only. Manual multipliers are unchanged.',
					}
				}
				const question = formData.get('clarificationQuestion')
				const answer = formData.get('clarificationAnswer')
				if (
					typeof question !== 'string' ||
					typeof answer !== 'string' ||
					!question.trim() ||
					!answer.trim()
				) {
					return {
						status: 'error' as const,
						quantityError:
							'Choose or enter one clarification answer. Manual multipliers are unchanged.',
					}
				}
				clarification = {
					question: question.trim().slice(0, 240),
					answer: answer.trim().slice(0, 240),
				}
			}

			const remaining = await quantityDependencies.usageRemaining(
				userId,
				'meal_quantity_proposal_llm_call',
				DAILY_QUANTITY_PROPOSAL_LIMIT,
			)
			if (remaining <= 0) {
				return {
					status: 'error' as const,
					quantityError: `You've reached the daily limit of ${DAILY_QUANTITY_PROPOSAL_LIMIT} quantity-planning calls. Manual multipliers are unchanged.`,
				}
			}

			const outcome = await quantityDependencies.propose(planningInput, {
				clarification,
			})
			if (!outcome.ok) {
				return { status: 'error' as const, quantityError: outcome.error }
			}

			// Record only a schema-valid response. Provider/parse/schema failures do
			// not write usage or canonical planning data.
			await quantityDependencies.recordUsage(
				userId,
				'meal_quantity_proposal_llm_call',
				DAILY_QUANTITY_PROPOSAL_LIMIT,
			)
			return {
				status: 'success' as const,
				quantityProposal: outcome.data,
			}
		}

		if (intent === 'applyMealQuantities') {
			const meal = await requireMeal(formData.get('mealId'))
			const selections = parseQuantitySelections(
				formData.get('quantitySelections'),
			)
			if (!selections.ok) {
				return { status: 'error' as const, quantityError: selections.error }
			}
			const selectedKeys = selections.data.map((selection) => selection.itemKey)
			const ownedItems = await db.mealRecipeItem.findMany({
				where: { mealId: meal.id, id: { in: selectedKeys } },
				select: { id: true },
			})
			invariantResponse(
				ownedItems.length === selectedKeys.length,
				'One or more Recipe items no longer belong to this Meal',
				{ status: 400 },
			)

			await db.$transaction(
				selections.data.map((selection) =>
					db.mealRecipeItem.update({
						where: { id: selection.itemKey },
						data: { scaleMultiplier: selection.scaleMultiplier },
					}),
				),
			)
			return {
				status: 'success' as const,
				quantitiesApplied: selections.data.length,
			}
		}

		// The explicit action that puts one Meal's ingredients on Shopping (#108
		// / #98 story 55). Planning itself never touches Shopping — only this
		// button does. Demand flows through the one pure module, availability
		// annotation and contribution reconciliation consume it at their own
		// seams, and each demand line leaves a current-state contribution keyed
		// to this Meal.
		if (intent === 'addMealToShopping' || intent === 'refreshMealShopping') {
			const meal = await requireMeal(formData.get('mealId'))
			// A text-only Meal has no Shopping behavior (#98 story 43).
			invariantResponse(
				meal.genericText == null,
				'A text-only Meal has no Shopping behavior',
				{ status: 400 },
			)

			// Missing cards (recipeId null) produce no fresh demand — a deleted
			// Recipe must be replaced or removed before it can contribute again.
			// Note-card Shopping lines contribute alongside Recipe items (#109);
			// a note-only snapshot Meal is a valid contributor.
			const [recipeItems, noteLines] = await Promise.all([
				db.mealRecipeItem.findMany({
					where: { mealId: meal.id },
					include: { recipe: { include: { ingredients: true } } },
				}),
				db.mealShoppingLine.findMany({
					where: { noteItem: { mealId: meal.id } },
					// noteItemId breaks ties between note items sharing an order value
					// — demand part order (and so composite quantities) must be
					// deterministic across identical adds.
					orderBy: [
						{ noteItem: { order: 'asc' } },
						{ noteItemId: 'asc' },
						{ order: 'asc' },
					],
					select: { name: true, quantity: true, unit: true },
				}),
			])
			if (intent === 'refreshMealShopping') {
				invariantResponse(
					recipeItems.every((item) => item.recipe != null),
					'Replace or remove missing Recipe cards before refreshing Shopping',
					{ status: 400 },
				)
			}

			const demand = buildShoppingDemand({
				recipeBatches: recipeItems.flatMap((item) =>
					item.recipe
						? [
								{
									ingredients: item.recipe.ingredients,
									scaleMultiplier: item.scaleMultiplier,
								},
							]
						: [],
				),
				noteLines,
			})

			const inventoryItems = await db.inventoryItem.findMany({
				where: { householdId },
				select: { name: true },
			})
			const { lines } = annotateInventoryMatches(demand, inventoryItems)

			const shoppingList = await ensureShoppingList(db, {
				userId,
				householdId,
			})
			const result =
				intent === 'refreshMealShopping'
					? await replaceMealShoppingContributions(db, {
							mealId: meal.id,
							listId: shoppingList.id,
							lines,
						})
					: await reconcileMealShoppingContributions(db, {
							mealId: meal.id,
							listId: shoppingList.id,
							lines,
						})

			// Since #109, attaching or changing a contribution can alter a
			// manual/source-Meal row's displayed total without creating a row.
			// Notify other open Shopping clients for every visible reconcile.
			const changedCount =
				result.createdRowCount +
				(result.attachedCount ?? 0) +
				('updatedContributionCount' in result
					? result.updatedContributionCount + result.removedContributionCount
					: 0)
			if (changedCount > 0) {
				void emitHouseholdEvent({
					type: 'shopping_list_generated',
					payload: { count: changedCount },
					userId,
					householdId,
				})
			}

			return {
				status: 'success' as const,
				shopping: result,
				refreshed: intent === 'refreshMealShopping',
			}
		}

		if (intent === 'removeItem') {
			const item = await requireItem(formData.get('itemId'))
			await removeRecipeItem(db, { item })
			return { status: 'success' as const }
		}

		if (intent === 'removeMeal') {
			const meal = await requireMeal(formData.get('mealId'))
			const removesShopping =
				formData.get('removeShoppingContributions') === 'true'
			if (removesShopping) {
				await removeMealWithShoppingContributions(db, { mealId: meal.id })
				void emitHouseholdEvent({
					type: 'shopping_list_generated',
					payload: { count: 0 },
					userId,
					householdId,
				})
			} else {
				await removeMeal(db, { mealId: meal.id })
			}
			return { status: 'success' as const }
		}

		if (intent === 'moveMeal') {
			const meal = await requireMeal(formData.get('mealId'))
			const direction = formData.get('direction')
			invariantResponse(
				direction === 'up' || direction === 'down',
				'Direction must be up or down',
			)
			await moveMealInDay(db, { meal, direction })
			return { status: 'success' as const }
		}

		if (intent === 'updateMealDetails') {
			const submission = parseWithZod(formData, { schema: MealDetailsSchema })
			if (submission.status !== 'success') {
				return { status: 'error' as const, submission: submission.reply() }
			}
			const { mealId, label, time, timeZone, guestCount, text } =
				submission.value
			const meal = await requireMeal(mealId)
			// Serving time is stored as one UTC instant plus its originating IANA
			// zone, recomputed from the Meal's semantic date (#98).
			const servingAt =
				time != null
					? servingInstantFromWallTime(meal.date, time, timeZone!)
					: null
			await db.meal.update({
				where: { id: meal.id },
				data: {
					label: label ?? null,
					servingAt,
					servingTimeZone: servingAt ? timeZone : null,
					guestCount: guestCount ?? null,
					// Generic text stays what identifies a text-only Meal — it is
					// editable but never removable or addable here (#98: text and
					// Recipe items are mutually exclusive for a saved Meal).
					...(meal.genericText != null && text != null
						? { genericText: text }
						: {}),
				},
			})
			return { status: 'success' as const }
		}

		return { status: 'error' as const }
	}
}

async function loadMealQuantityPlanningInput(
	db: PrismaClient,
	{
		mealId,
		householdId,
	}: {
		mealId: string
		householdId: string
	},
): Promise<QuantityPlanningInput | { error: string }> {
	const meal = await db.meal.findFirstOrThrow({
		where: { id: mealId, mealPlan: { householdId } },
		select: {
			guestCount: true,
			sections: {
				orderBy: [{ order: 'asc' }, { id: 'asc' }],
				select: { id: true, name: true },
			},
			recipeItems: {
				orderBy: [{ order: 'asc' }, { id: 'asc' }],
				select: {
					id: true,
					order: true,
					sectionId: true,
					recipeTitle: true,
					scaleMultiplier: true,
					note: true,
					recipe: {
						select: {
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
			noteItems: {
				orderBy: [{ order: 'asc' }, { id: 'asc' }],
				select: { id: true, order: true, sectionId: true, text: true },
			},
		},
	})

	if (meal.guestCount == null) {
		return {
			error:
				'Add a guest count in Meal details before planning quantities. Manual multipliers are unchanged.',
		}
	}
	if (meal.recipeItems.some((item) => item.recipe == null)) {
		return {
			error:
				'Replace or remove missing Recipe cards before planning quantities. Manual multipliers are unchanged.',
		}
	}

	type PlanningItem = QuantityPlanningInput['sections'][number]['items'][number]
	type OrderedPlanningItem = {
		order: number
		tieKey: string
		item: PlanningItem
	}
	function itemsForSection(sectionId: string | null): PlanningItem[] {
		const recipes: OrderedPlanningItem[] = meal.recipeItems
			.filter((item) => item.sectionId === sectionId)
			.map((item) => ({
				order: item.order,
				tieKey: `recipe:${item.id}`,
				item: {
					kind: 'recipe' as const,
					itemKey: item.id,
					recipe: {
						title: item.recipeTitle,
						description: item.recipe!.description,
						note: item.note,
						currentScaleMultiplier: item.scaleMultiplier,
						ingredients: item.recipe!.ingredients,
						instructions: item.recipe!.instructions,
					},
				},
			}))
		const notes: OrderedPlanningItem[] = meal.noteItems
			.filter((item) => item.sectionId === sectionId)
			.map((item) => ({
				order: item.order,
				tieKey: `note:${item.id}`,
				item: { kind: 'note' as const, text: item.text },
			}))
		return [...recipes, ...notes]
			.sort((a, b) => a.order - b.order || a.tieKey.localeCompare(b.tieKey))
			.map(({ item }) => item)
	}

	const sections: QuantityPlanningInput['sections'] = meal.sections.map(
		(section) => ({
			name: section.name,
			items: itemsForSection(section.id),
		}),
	)
	const unsectioned = itemsForSection(null)
	if (unsectioned.length > 0 || sections.length === 0) {
		sections.push({ name: null, items: unsectioned })
	}

	return {
		context: 'planned-meal',
		guestCount: meal.guestCount,
		sections,
	}
}
