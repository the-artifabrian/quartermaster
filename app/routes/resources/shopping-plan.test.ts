/**
 * The From Plan picker's choices for a week, and which lines read as a Meal's
 * own amount on the list.
 */
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { addMealToShopping } from '#app/utils/shopping-adds.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { createSignedInHousehold } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './shopping-plan.tsx'
import '#tests/setup/db-setup.ts'

const PATH = '/resources/shopping-plan'
const ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: PATH,
	url: new URL(`${BASE_URL}${PATH}`),
}

const setupHousehold = (name: string) => createSignedInHousehold({ name })

async function loadWeek(session: { id: string }, weekStart?: Date) {
	const cookie = await getSessionCookieHeader(session)
	const url = new URL(`${BASE_URL}${PATH}`)
	if (weekStart) url.searchParams.set('weekStart', serializeDate(weekStart))
	return loader({
		request: new Request(url, { headers: { cookie } }),
		...ARGS_BASE,
		url,
	})
}

test('the Plan picker requires an authenticated household', async () => {
	await expect(
		loader({ request: new Request(`${BASE_URL}${PATH}`), ...ARGS_BASE }),
	).rejects.toMatchObject({ status: 302 })
})

test('default ticks skip a Staple, a pantry line and a line already on the list', async () => {
	const session = await setupHousehold('Picker household')
	await prisma.householdIngredient.create({
		data: {
			householdId: session.householdId,
			displayName: 'Olives',
			canonicalKey: 'olives',
			isStaple: true,
		},
	})
	const list = await ensureShoppingList(prisma, {
		userId: session.userId,
		householdId: session.householdId,
	})
	await prisma.shoppingListItem.create({
		data: { listId: list.id, name: 'Feta', source: 'manual' },
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Greek salad',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: {
				create: [
					{ name: 'cucumber', amount: '2', order: 0 },
					{ name: 'olives', amount: '1', unit: 'cup', order: 1 },
					{ name: 'salt', order: 2 },
					{ name: 'feta', amount: '200', unit: 'g', order: 3 },
				],
			},
		},
	})
	const weekStart = getWeekStart(new Date())
	await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart,
			meals: {
				create: {
					date: weekStart,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})

	const result = await loadWeek(session, weekStart)

	const meal = result.data.days[0]!.meals[0]!
	// A single-Recipe Meal is named after its Recipe, with the label beside it.
	expect(meal).toMatchObject({ title: 'Greek salad', label: 'Dinner' })
	expect(
		Object.fromEntries(
			meal.lines.map((line) => [line.canonicalName, line.status]),
		),
	).toEqual({
		cucumber: 'needed',
		// A saved household Staple: assumed on hand.
		olive: 'on-hand',
		// The plain-basics heuristic, which the picker keeps for its defaults.
		salt: 'on-hand',
		// Already a row on the list, without this Meal's amount.
		feta: 'name-on-list',
	})
})

type Session = Awaited<ReturnType<typeof setupHousehold>>

async function createRecipe(
	session: Session,
	title: string,
	ingredients: Array<{ name: string; amount?: string; unit?: string }>,
) {
	return prisma.recipe.create({
		data: {
			title,
			userId: session.userId,
			householdId: session.householdId,
			ingredients: {
				create: ingredients.map((ingredient, order) => ({
					...ingredient,
					order,
				})),
			},
		},
	})
}

/** One Meal per Recipe, on the week's Monday, in order. */
async function planWeek(
	session: Session,
	recipes: Array<{ id: string; title: string }>,
) {
	const weekStart = getWeekStart(new Date())
	const plan = await prisma.mealPlan.create({
		data: { householdId: session.householdId, weekStart },
	})
	const meals = []
	for (const [order, recipe] of recipes.entries()) {
		meals.push(
			await prisma.meal.create({
				data: {
					mealPlanId: plan.id,
					date: weekStart,
					order,
					recipeItems: {
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
						},
					},
				},
			}),
		)
	}
	const list = await ensureShoppingList(prisma, {
		userId: session.userId,
		householdId: session.householdId,
	})
	return { weekStart, meals, listId: list.id }
}

/** Add to Shopping for one Meal, through the app's own Meal-add path. */
function addToShopping(session: Session, mealId: string, listId: string) {
	return addMealToShopping(prisma, {
		mealId,
		householdId: session.householdId,
		listId,
		refresh: false,
	})
}

/** Each Meal's line statuses, keyed by canonical name. */
async function statuses(session: Session, weekStart: Date) {
	const result = await loadWeek(session, weekStart)
	return result.data.days
		.flatMap((day) => day.meals)
		.map((meal) =>
			Object.fromEntries(
				meal.lines.map((line) => [line.canonicalName, line.status]),
			),
		)
}

test('a line this Meal added is on the list; the same line from another Meal is not its amount', async () => {
	const session = await setupHousehold('Two salads')
	// Capitals and plurals on one side, the singular on the other: the
	// loader has to key them the way the writer did.
	const first = await createRecipe(session, 'Tomato salad', [
		{ name: 'Red Onions', amount: '2' },
		{ name: 'basil', amount: '1', unit: 'bunch' },
	])
	const second = await createRecipe(session, 'Tomato pasta', [
		{ name: 'red onion', amount: '1' },
		{ name: 'spaghetti', amount: '500', unit: 'g' },
	])
	const { weekStart, meals, listId } = await planWeek(session, [first, second])
	await addToShopping(session, meals[0]!.id, listId)

	expect(await statuses(session, weekStart)).toEqual([
		{ 'red onion': 'added', basil: 'added' },
		{ 'red onion': 'name-on-list', spaghetti: 'needed' },
	])
})

test('a typed row and a Recipe-detail row with a line’s name are not the Meal’s amount', async () => {
	const session = await setupHousehold('Typed rows')
	const recipe = await createRecipe(session, 'Greek salad', [
		{ name: 'feta', amount: '200', unit: 'g' },
		{ name: 'cucumber', amount: '1' },
		{ name: 'red onion', amount: '1' },
	])
	const { weekStart, listId } = await planWeek(session, [recipe])
	await prisma.shoppingListItem.createMany({
		data: [
			{ listId, name: 'Feta', source: 'manual' },
			{ listId, name: 'Cucumbers', quantity: '2', source: 'recipe' },
		],
	})

	expect(await statuses(session, weekStart)).toEqual([
		{ feta: 'name-on-list', cucumber: 'name-on-list', 'red onion': 'needed' },
	])
})

test('a deleted row takes the Meal’s amount with it, and a checked row keeps it', async () => {
	const session = await setupHousehold('Bought and deleted')
	const recipe = await createRecipe(session, 'Greek salad', [
		{ name: 'feta', amount: '200', unit: 'g' },
		{ name: 'cucumber', amount: '1' },
	])
	const { weekStart, meals, listId } = await planWeek(session, [recipe])
	await addToShopping(session, meals[0]!.id, listId)
	await prisma.shoppingListItem.deleteMany({
		where: { listId, name: 'cucumber' },
	})
	await prisma.shoppingListItem.updateMany({
		where: { listId, name: 'feta' },
		data: { checked: true },
	})

	expect(await statuses(session, weekStart)).toEqual([
		{ feta: 'added', cucumber: 'needed' },
	])
})

test('an amount left by a deleted Meal is not another Meal’s', async () => {
	const session = await setupHousehold('Deleted Meal')
	const gone = await createRecipe(session, 'Feta toast', [
		{ name: 'feta', amount: '100', unit: 'g' },
	])
	const kept = await createRecipe(session, 'Greek salad', [
		{ name: 'feta', amount: '200', unit: 'g' },
	])
	const { weekStart, meals, listId } = await planWeek(session, [gone, kept])
	await addToShopping(session, meals[0]!.id, listId)
	await prisma.meal.delete({ where: { id: meals[0]!.id } })
	// The row stays, with an amount that no Meal owns now.
	expect(
		await prisma.mealShoppingContribution.findMany({
			select: { mealId: true, canonicalName: true },
		}),
	).toEqual([{ mealId: null, canonicalName: 'feta' }])

	expect(await statuses(session, weekStart)).toEqual([{ feta: 'name-on-list' }])
})

test('a Staple line the Meal put on the list is on the list, not usually on hand', async () => {
	const session = await setupHousehold('Staples')
	const recipe = await createRecipe(session, 'Puttanesca', [
		{ name: 'olives', amount: '100', unit: 'g' },
		{ name: 'capers', amount: '1', unit: 'tbsp' },
	])
	await prisma.householdIngredient.create({
		data: {
			householdId: session.householdId,
			displayName: 'Capers',
			canonicalKey: 'caper',
			isStaple: true,
		},
	})
	const { weekStart, meals, listId } = await planWeek(session, [recipe])
	// Olives go on Shopping first, and become a Staple afterwards.
	await addToShopping(session, meals[0]!.id, listId)
	await prisma.householdIngredient.create({
		data: {
			householdId: session.householdId,
			displayName: 'Olives',
			canonicalKey: 'olive',
			isStaple: true,
		},
	})

	expect(await statuses(session, weekStart)).toEqual([
		{ olive: 'added', caper: 'on-hand' },
	])
})

// Reading as on Later lets From Plan move it to Next shop.
test('a Meal’s amount on an unchecked Later row is on Later; a checked one is on the list', async () => {
	const session = await setupHousehold('Later')
	const recipe = await createRecipe(session, 'Lemon tart', [
		{ name: 'lemons', amount: '3' },
		{ name: 'butter', amount: '100', unit: 'g' },
	])
	const { weekStart, meals, listId } = await planWeek(session, [recipe])
	await addToShopping(session, meals[0]!.id, listId)
	await prisma.shoppingListItem.updateMany({
		where: { listId },
		data: { horizon: 'later' },
	})
	await prisma.shoppingListItem.updateMany({
		where: { listId, name: 'butter' },
		data: { checked: true },
	})

	expect(await statuses(session, weekStart)).toEqual([
		{ lemon: 'later', butter: 'added' },
	])
})

test('a Meal scaled after it was added shows the amount Shopping has, not the new one', async () => {
	const session = await setupHousehold('Scaled')
	const recipe = await createRecipe(session, 'Chicken traybake', [
		{ name: 'chicken thighs', amount: '8' },
		{ name: 'lemon', amount: '1' },
	])
	const { weekStart, meals, listId } = await planWeek(session, [recipe])
	await addToShopping(session, meals[0]!.id, listId)
	await prisma.mealRecipeItem.updateMany({
		where: { mealId: meals[0]!.id },
		data: { scaleMultiplier: 2 },
	})

	const result = await loadWeek(session, weekStart)

	expect(
		result.data.days[0]!.meals[0]!.lines.map(
			({ name, quantity, status, contributed }) => ({
				name,
				quantity,
				status,
				contributed,
			}),
		),
	).toEqual([
		{
			name: 'chicken thighs',
			quantity: '16',
			status: 'changed',
			contributed: { quantity: '8', unit: null },
		},
		{
			name: 'lemon',
			quantity: '2',
			status: 'changed',
			contributed: { quantity: '1', unit: null },
		},
	])
})

test('an unsaved ingredient is needed, and cooked items are never offered', async () => {
	const session = await setupHousehold('Tapenade household')
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Tapenade',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: { create: [{ name: 'olives', amount: '1', order: 0 }] },
		},
	})
	const cooked = await prisma.recipe.create({
		data: {
			title: 'Toast',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: { create: [{ name: 'sourdough', order: 0 }] },
		},
	})
	const weekStart = getWeekStart(new Date())
	await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart,
			meals: {
				create: [
					{
						date: weekStart,
						order: 0,
						recipeItems: {
							create: [
								{
									order: 0,
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									scaleMultiplier: 1,
								},
								{
									order: 1,
									recipeId: cooked.id,
									recipeTitle: cooked.title,
									scaleMultiplier: 1,
									cooked: true,
								},
							],
						},
					},
					// Text-only Meals and Meals with nothing left to buy drop out.
					{ date: weekStart, order: 1, genericText: 'Leftovers' },
				],
			},
		},
	})

	const result = await loadWeek(session, weekStart)

	expect(result.data.days).toHaveLength(1)
	expect(result.data.days[0]!.meals).toHaveLength(1)
	// The picker row reads like the Plan card: every Recipe card on the Meal,
	// cooked ones included, even though only the uncooked lines are offered.
	expect(result.data.days[0]!.meals[0]).toMatchObject({
		title: '2-recipe Meal',
		recipeTitles: ['Tapenade', 'Toast'],
	})
	expect(
		result.data.days[0]!.meals[0]!.lines.map((line) => [
			line.canonicalName,
			line.status,
		]),
	).toEqual([['olive', 'needed']])
})

test('note-card Shopping lines are offered alongside Recipe lines', async () => {
	const session = await setupHousehold('Menu household')
	const weekStart = getWeekStart(new Date())
	await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart,
			meals: {
				create: {
					date: weekStart,
					order: 0,
					label: 'lunch',
					noteItems: {
						create: {
							order: 0,
							text: 'Bread from the bakery',
							shoppingLines: {
								create: [{ name: 'sourdough loaf', quantity: '1', order: 0 }],
							},
						},
					},
				},
			},
		},
	})

	const result = await loadWeek(session, weekStart)

	const meal = result.data.days[0]!.meals[0]!
	// No Recipe card to name it after, so the familiar label is the title.
	expect(meal.title).toBe('Lunch')
	expect(meal.label).toBeNull()
	expect(meal.lines.map((line) => [line.name, line.status])).toEqual([
		['sourdough loaf', 'needed'],
	])
})

test('a week with no Plan is an empty picker, not an error', async () => {
	const session = await setupHousehold('Empty household')

	const result = await loadWeek(session)

	expect(result.data.days).toEqual([])
	expect(result.init?.headers).toEqual({ 'Cache-Control': 'private, no-store' })
})
