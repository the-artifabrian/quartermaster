import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { addDaysUTC, getWeekStart, parseDate, serializeDate } from './date.ts'
import { householdIngredientKey } from './household-ingredient.ts'
import { parseIngredient } from './ingredient-parser.ts'
import { ensureMealPlan } from './meal-plan.server.ts'
import {
	addRecipeToMeal,
	createMealWithItems,
	createRecipeMeal,
	setMealCooked,
} from './meal.server.ts'
import { resolveRecipeMetadataValueIds } from './recipe-metadata.server.ts'
import {
	SAMPLE_HOUSEHOLD,
	type SampleHouseholdContent,
	type SampleRecipe,
} from './sample-household-data.ts'
import { addMealToShopping } from './shopping-adds.server.ts'
import { demandIdentity } from './shopping-demand.server.ts'
import { ensureShoppingList } from './shopping-list-persistence.server.ts'
import { guessCategory } from './shopping-list-validation.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * Fills one Household with the sample data, in two parts:
 *
 * - addSampleLibrary saves the Recipes and Staples. They don't depend on the
 *   date.
 * - planSampleWeek plans the week of `today` (a `yyyy-MM-dd` day), puts its
 *   Meals on Shopping, marks the Meals before today cooked and checks a few
 *   rows. A per-visitor copy of a template Household is the part to re-run or
 *   re-date, so the copy opens on its own week.
 *
 * How many Meals end up cooked depends on the weekday: none on a Monday,
 * every Meal before today on the other days.
 *
 * Every write goes through the function the app itself uses for it, so the
 * rows look like real use made them: parsed ingredient lines, classification
 * values, Meal Shopping contributions. Both parts take the client rather
 * than a transaction because the Meal and Shopping writers open their own.
 *
 * Running it again adds nothing twice. An existing Recipe is matched by title
 * and skipped whole, so a change to the content (a photo included) reaches
 * only a fresh database. Staples are matched by name.
 */
export async function fillSampleHousehold(
	db: PrismaClient,
	options: {
		userId: string
		householdId: string
		today: string
		content?: SampleHouseholdContent
	},
) {
	// The Staples go in first: they keep their ingredients off Shopping.
	await addSampleLibrary(db, options)
	await planSampleWeek(db, options)
}

/** The sample Recipes and Staples the Household doesn't have yet. */
export async function addSampleLibrary(
	db: PrismaClient,
	{
		userId,
		householdId,
		content = SAMPLE_HOUSEHOLD,
	}: {
		userId: string
		householdId: string
		content?: SampleHouseholdContent
	},
) {
	await addRecipes(db, { userId, householdId }, content.recipes)
	for (const name of content.staples) {
		const canonicalKey = householdIngredientKey(name)
		await db.householdIngredient.upsert({
			where: { householdId_canonicalKey: { householdId, canonicalKey } },
			create: { householdId, displayName: name, canonicalKey, isStaple: true },
			update: { isStaple: true },
		})
	}
}

/**
 * The sample Plan for the week of `today` and the Shopping it leads to. The
 * Recipes it names and the Staples must be saved first (addSampleLibrary).
 *
 * It does nothing while the Household has Meals in another week, so a run a
 * week later leaves last week's Plan and its Shopping alone. Within the week,
 * Meals are matched by day, label and Recipe, Add to Shopping skips amounts a
 * Meal already has on the list, and a typed row already on the list is left.
 */
export async function planSampleWeek(
	db: PrismaClient,
	{
		userId,
		householdId,
		today,
		content = SAMPLE_HOUSEHOLD,
	}: {
		userId: string
		householdId: string
		today: string
		content?: SampleHouseholdContent
	},
) {
	const recipes = await recipesByTitle(db, householdId, content)
	const weekStart = getWeekStart(parseDate(today))
	if (await hasMealsOutsideWeek(db, householdId, weekStart)) return

	const plan = await ensureMealPlan(db, { householdId, weekStart })
	const meals: Array<{ id: string; date: Date; genericText: string | null }> =
		[]
	for (const meal of content.plan) {
		const date = addDaysUTC(weekStart, meal.day)
		if ('text' in meal) {
			const existing = await db.meal.findFirst({
				where: { mealPlanId: plan.id, date, genericText: meal.text },
				select: { id: true },
			})
			const id =
				existing?.id ??
				(await createMealWithItems(db, {
					mealPlanId: plan.id,
					date,
					label: meal.label,
					genericText: meal.text,
					items: [],
				}))
			meals.push({ id, date, genericText: meal.text })
			continue
		}
		const [first, ...rest] = meal.recipes.map((title) => {
			const recipe = recipes.get(title)
			if (!recipe) throw new Error(`The sample Plan names no Recipe "${title}"`)
			return recipe
		})
		const { mealId } = await createRecipeMeal(db, {
			mealPlanId: plan.id,
			date,
			label: meal.label,
			recipe: first!,
		})
		for (const recipe of rest) {
			await addRecipeToMeal(db, {
				meal: { id: mealId, genericText: null },
				recipe,
			})
		}
		meals.push({ id: mealId, date, genericText: null })
	}

	// Every Meal's amounts go on Shopping before any Meal is cooked, as if
	// the week was shopped for on the weekend. A cooked Meal adds nothing, so
	// the other order would leave Shopping depending on the weekday.
	const list = await ensureShoppingList(db, { userId, householdId })
	for (const meal of meals) {
		if (meal.genericText != null) continue
		await addMealToShopping(db, {
			mealId: meal.id,
			householdId,
			listId: list.id,
			refresh: false,
		})
	}
	for (const meal of meals) {
		if (serializeDate(meal.date) < today) {
			await setMealCooked(db, { meal, cooked: true })
		}
	}

	// Typed rows go in the way Shopping's add form puts them in.
	const rows = await db.shoppingListItem.findMany({
		where: { listId: list.id },
		select: { name: true },
	})
	const onList = new Set(rows.map((row) => demandIdentity(row.name)))
	for (const row of content.shopping.manual) {
		if (onList.has(demandIdentity(row.name))) continue
		await db.shoppingListItem.create({
			data: {
				name: row.name,
				quantity: row.quantity ?? null,
				unit: row.unit ?? null,
				category: guessCategory(row.name),
				listId: list.id,
				source: 'manual',
				horizon: row.horizon,
			},
		})
	}

	// Checks come last, once every amount they cover is on the row: new
	// demand never joins a checked row.
	const toCheck = new Set(
		[
			...content.shopping.manual
				.filter((row) => row.checked)
				.map((row) => row.name),
			...content.shopping.checkedMealLines,
		].map(demandIdentity),
	)
	const unchecked = await db.shoppingListItem.findMany({
		where: { listId: list.id, checked: false },
		select: { id: true, name: true },
	})
	for (const row of unchecked) {
		if (!toCheck.has(demandIdentity(row.name))) continue
		await db.shoppingListItem.update({
			where: { id: row.id },
			data: { checked: true, lastCheckMutationId: createId() },
		})
	}
}

/** Saves the Recipes the Household doesn't have yet, the way New Recipe does. */
async function addRecipes(
	db: PrismaClient,
	{ userId, householdId }: { userId: string; householdId: string },
	recipes: SampleRecipe[],
) {
	for (const recipe of recipes) {
		await writeTransaction(db, async (tx) => {
			const existing = await tx.recipe.findFirst({
				where: { householdId, title: recipe.title },
				select: { id: true },
			})
			if (existing) return
			const metadataValueIds = await resolveRecipeMetadataValueIds(
				tx,
				householdId,
				{
					selectedValueIds: [],
					newValues: {
						cuisine: recipe.classification.cuisine ?? [],
						season: recipe.classification.season ?? [],
						course: recipe.classification.course ?? [],
					},
				},
			)
			await tx.recipe.create({
				data: {
					title: recipe.title,
					description: recipe.description,
					activeTime: recipe.activeTime,
					totalTime: recipe.totalTime,
					yieldAmount: recipe.yieldAmount,
					yieldLabel: recipe.yieldLabel,
					notes: recipe.notes ?? null,
					userId,
					householdId,
					metadataAssignments: {
						create: metadataValueIds.map((valueId) => ({ valueId })),
					},
					ingredients: {
						create: recipe.ingredients.map((line, order) => ({
							...ingredientRow(line),
							order,
						})),
					},
					instructions: {
						create: recipe.steps.map((content, order) => ({ content, order })),
					},
				},
			})
		})
	}
}

/** The Household's Recipes the sample Plan names, by title; the oldest wins. */
async function recipesByTitle(
	db: PrismaClient,
	householdId: string,
	content: SampleHouseholdContent,
) {
	const titles = content.plan.flatMap((meal) =>
		'recipes' in meal ? meal.recipes : [],
	)
	const saved = await db.recipe.findMany({
		where: {
			householdId,
			title: { in: titles },
		},
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		select: { id: true, title: true },
	})
	const byTitle = new Map<string, { id: string; title: string }>()
	for (const recipe of saved) {
		if (!byTitle.has(recipe.title)) byTitle.set(recipe.title, recipe)
	}
	return byTitle
}

function ingredientRow(line: SampleRecipe['ingredients'][number]) {
	if (typeof line !== 'string') {
		return { name: line.heading, isHeading: true }
	}
	const parsed = parseIngredient(line)
	if (!parsed?.name) {
		throw new Error(`The sample ingredient "${line}" doesn't parse`)
	}
	return {
		name: parsed.name,
		amount: parsed.amount ?? null,
		unit: parsed.unit ?? null,
		notes: parsed.notes ?? null,
	}
}

/**
 * Whether the Household has Meals in another week. Compared in JS: legacy
 * Meal dates can be stored in two formats that SQL comparisons don't equate.
 */
async function hasMealsOutsideWeek(
	db: PrismaClient,
	householdId: string,
	weekStart: Date,
) {
	const meals = await db.meal.findMany({
		where: { mealPlan: { householdId } },
		select: { date: true },
	})
	const first = serializeDate(weekStart)
	const last = serializeDate(addDaysUTC(weekStart, 6))
	return meals.some((meal) => {
		const day = serializeDate(meal.date)
		return day < first || day > last
	})
}
