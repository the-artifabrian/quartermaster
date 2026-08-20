import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { getWeekStart } from '#app/utils/date.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	AddMealSchema,
	AddTextMealSchema,
	MealDetailsSchema,
} from '#app/utils/meal-plan-validation.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
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
import { reconcileMealShoppingContributions } from '#app/utils/shopping-contribution.server.ts'
import { buildShoppingDemand } from '#app/utils/shopping-demand.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { annotateInventoryMatches } from '#app/utils/shopping-list.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'

type PlanActionUser = Pick<
	Awaited<ReturnType<typeof requireUserWithTier>>,
	'userId' | 'householdId'
>

export function createPlanAction(
	db: PrismaClient,
	requirePlanUser: (
		request: Request,
	) => Promise<PlanActionUser> = requireUserWithTier,
) {
	return async function planAction({ request }: { request: Request }) {
		const { userId, householdId } = await requirePlanUser(request)
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

		// The explicit action that puts one Meal's ingredients on Shopping (#108
		// / #98 story 55). Planning itself never touches Shopping — only this
		// button does. Demand flows through the one pure module, availability
		// annotation and contribution reconciliation consume it at their own
		// seams, and each demand line leaves a current-state contribution keyed
		// to this Meal.
		if (intent === 'addMealToShopping') {
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
					where: { mealId: meal.id, recipeId: { not: null } },
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
			const result = await reconcileMealShoppingContributions(db, {
				mealId: meal.id,
				listId: shoppingList.id,
				lines,
			})

			// Attach-only reconciles change nothing displayed — no event then.
			if (result.createdRowCount > 0) {
				void emitHouseholdEvent({
					type: 'shopping_list_generated',
					payload: { count: result.createdRowCount },
					userId,
					householdId,
				})
			}

			return { status: 'success' as const, shopping: result }
		}

		if (intent === 'removeItem') {
			const item = await requireItem(formData.get('itemId'))
			await removeRecipeItem(db, { item })
			return { status: 'success' as const }
		}

		if (intent === 'removeMeal') {
			const meal = await requireMeal(formData.get('mealId'))
			await removeMeal(db, { mealId: meal.id })
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
