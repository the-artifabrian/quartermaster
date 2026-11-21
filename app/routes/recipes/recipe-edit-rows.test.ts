/**
 * Editing a Recipe keeps the ids of the ingredient and step rows it keeps.
 * Cooking checks (use-cooking-progress.ts) and the one-ingredient Add to
 * Shopping are keyed on those ids.
 *
 * Failure list:
 * - Editing one step's text gives every row a new id (checks gone).
 * - Reordering rows, or moving an ingredient under another heading, gives
 *   them new ids or loses the new order.
 * - Removing a middle row removes, or renumbers, its neighbours.
 * - Adding a row reuses or disturbs an existing row.
 * - A submitted id from another Recipe (another Household's or this
 *   Household's) updates that row instead of saving a new one here.
 * - A submitted id whose row was deleted meanwhile fails the save, or brings
 *   the old id back.
 * - The same id submitted twice saves one row, or updates one row twice.
 * - A linked-Recipe ingredient loses its link or its id on an unrelated edit.
 * - A row another member added while the form was open is deleted by the
 *   save, or lands in the middle of the editor's order.
 * - A form from before the loaded-ids field (a tab open across a deploy)
 *   stops removing the rows it removed.
 * - New saves something different once the parser is shared, or takes a
 *   submitted id.
 */
import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as editAction } from './$recipeId_.edit.tsx'
import { action as newAction } from './new.tsx'
import '#tests/setup/db-setup.ts'

function routeArgs<
	TParams extends Record<string, string> = Record<string, never>,
>(path: string, params: TParams = {} as TParams) {
	return {
		params,
		context: new RouterContextProvider(),
		pattern: path,
		url: new URL(`${BASE_URL}${path}`),
	}
}

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Recipe edit household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function post(
	session: { id: string },
	path: string,
	fields: Array<[string, string]>,
) {
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			cookie: await getSessionCookieHeader(session),
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(fields).toString(),
	})
}

type IngredientRow = {
	id?: string
	name: string
	amount?: string
	unit?: string
	notes?: string
	isHeading?: boolean
	linkedRecipeId?: string
}
type StepRow = { id?: string; content: string }

/** The fields the Recipe form posts for these rows, by position. */
function rowFields(ingredients: IngredientRow[], steps: StepRow[]) {
	const fields: Array<[string, string]> = []
	ingredients.forEach((row, index) => {
		const prefix = `ingredients[${index}]`
		if (row.id) fields.push([`${prefix}.id`, row.id])
		fields.push([`${prefix}.name`, row.name])
		fields.push([`${prefix}.amount`, row.amount ?? ''])
		fields.push([`${prefix}.unit`, row.unit ?? ''])
		fields.push([`${prefix}.notes`, row.notes ?? ''])
		fields.push([`${prefix}.isHeading`, row.isHeading ? 'true' : ''])
		if (row.linkedRecipeId) {
			fields.push([`${prefix}.linkedRecipeId`, row.linkedRecipeId])
		}
	})
	steps.forEach((row, index) => {
		if (row.id) fields.push([`instructions[${index}].id`, row.id])
		fields.push([`instructions[${index}].content`, row.content])
	})
	return fields
}

async function createRecipe(
	owner: { userId: string; householdId: string },
	title = 'Tomato soup',
) {
	return prisma.recipe.create({
		data: {
			title,
			userId: owner.userId,
			householdId: owner.householdId,
			ingredients: {
				create: [
					{ name: 'Soup', isHeading: true, order: 0 },
					{ name: 'tomatoes', amount: '800', unit: 'g', order: 1 },
					{ name: 'onion', amount: '1', order: 2 },
					{ name: 'stock', amount: '1', unit: 'l', order: 3 },
				],
			},
			instructions: {
				create: [
					{ content: 'Soften the onion.', order: 0 },
					{ content: 'Add the tomatoes and stock.', order: 1 },
					{ content: 'Simmer for 20 minutes.', order: 2 },
				],
			},
		},
		include: {
			ingredients: { orderBy: { order: 'asc' } },
			instructions: { orderBy: { order: 'asc' } },
		},
	})
}

type LoadedRecipe = Awaited<ReturnType<typeof createRecipe>>

/** The rows as the edit form loads them, ready to change and post back. */
function loadedRows(recipe: LoadedRecipe) {
	return {
		ingredients: recipe.ingredients.map((row): IngredientRow => ({
			id: row.id,
			name: row.name,
			amount: row.amount ?? undefined,
			unit: row.unit ?? undefined,
			notes: row.notes ?? undefined,
			isHeading: row.isHeading,
			linkedRecipeId: row.linkedRecipeId ?? undefined,
		})),
		steps: recipe.instructions.map((row): StepRow => ({
			id: row.id,
			content: row.content,
		})),
	}
}

/** The ids the form loaded, which it posts so the save removes only those. */
function loadedIdFields(recipe: LoadedRecipe): Array<[string, string]> {
	return [
		[
			'loadedIngredientIds',
			JSON.stringify(recipe.ingredients.map((row) => row.id)),
		],
		[
			'loadedInstructionIds',
			JSON.stringify(recipe.instructions.map((row) => row.id)),
		],
	]
}

async function saveEdit(
	session: { id: string },
	recipe: LoadedRecipe,
	ingredients: IngredientRow[],
	steps: StepRow[],
	{ loadedIds = loadedIdFields(recipe) } = {},
) {
	const response = await editAction({
		request: await post(session, `/recipes/${recipe.id}/edit`, [
			['title', recipe.title],
			...rowFields(ingredients, steps),
			...loadedIds,
		]),
		...routeArgs('/recipes/:recipeId/edit', { recipeId: recipe.id }),
	})
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
}

function savedRows(recipeId: string) {
	return prisma.recipe.findUniqueOrThrow({
		where: { id: recipeId },
		select: {
			ingredients: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					amount: true,
					unit: true,
					notes: true,
					isHeading: true,
					linkedRecipeId: true,
					order: true,
				},
			},
			instructions: {
				orderBy: { order: 'asc' },
				select: { id: true, content: true, order: true },
			},
		},
	})
}

test('editing one step’s text keeps every ingredient and step id', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(
		session,
		recipe,
		ingredients,
		steps.map((step, index) =>
			index === 2 ? { ...step, content: 'Simmer for 25 minutes.' } : step,
		),
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => row.id)).toEqual(
		recipe.ingredients.map((row) => row.id),
	)
	expect(saved.instructions).toEqual([
		{ id: recipe.instructions[0]!.id, content: 'Soften the onion.', order: 0 },
		{
			id: recipe.instructions[1]!.id,
			content: 'Add the tomatoes and stock.',
			order: 1,
		},
		{
			id: recipe.instructions[2]!.id,
			content: 'Simmer for 25 minutes.',
			order: 2,
		},
	])
})

test('reordering keeps each row’s id and saves the new order', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)
	const [heading, tomatoes, onion, stock] = ingredients

	await saveEdit(
		session,
		recipe,
		[onion!, heading!, stock!, tomatoes!],
		[steps[1]!, steps[0]!, steps[2]!],
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => [row.id, row.order])).toEqual([
		[onion!.id, 0],
		[heading!.id, 1],
		[stock!.id, 2],
		[tomatoes!.id, 3],
	])
	expect(saved.instructions.map((row) => [row.id, row.order])).toEqual([
		[steps[1]!.id, 0],
		[steps[0]!.id, 1],
		[steps[2]!.id, 2],
	])
})

test('removing a middle row removes only that row', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(
		session,
		recipe,
		ingredients.filter((_, index) => index !== 2),
		steps.filter((_, index) => index !== 1),
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => [row.id, row.name, row.order])).toEqual(
		[
			[ingredients[0]!.id, 'Soup', 0],
			[ingredients[1]!.id, 'tomatoes', 1],
			[ingredients[3]!.id, 'stock', 2],
		],
	)
	expect(saved.instructions.map((row) => [row.id, row.order])).toEqual([
		[steps[0]!.id, 0],
		[steps[2]!.id, 1],
	])
	expect(
		await prisma.ingredient.count({ where: { id: ingredients[2]!.id } }),
	).toBe(0)
})

test('adding a row saves it with a new id and leaves the others alone', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(
		session,
		recipe,
		[
			...ingredients.slice(0, 2),
			{ name: 'garlic', amount: '2', unit: 'cloves' },
			...ingredients.slice(2),
		],
		[...steps, { content: 'Blend until smooth.' }],
	)

	const saved = await savedRows(recipe.id)
	const known = new Set([
		...recipe.ingredients.map((row) => row.id),
		...recipe.instructions.map((row) => row.id),
	])
	expect(saved.ingredients.map((row) => row.name)).toEqual([
		'Soup',
		'tomatoes',
		'garlic',
		'onion',
		'stock',
	])
	expect(saved.ingredients[2]).toMatchObject({ amount: '2', unit: 'cloves' })
	expect(known.has(saved.ingredients[2]!.id)).toBe(false)
	expect(
		saved.ingredients.filter((row) => row.name !== 'garlic').map((r) => r.id),
	).toEqual(recipe.ingredients.map((row) => row.id))
	expect(saved.instructions.slice(0, 3).map((row) => row.id)).toEqual(
		recipe.instructions.map((row) => row.id),
	)
	expect(saved.instructions[3]).toMatchObject({
		content: 'Blend until smooth.',
		order: 3,
	})
	expect(known.has(saved.instructions[3]!.id)).toBe(false)
})

test('an ingredient id from another Recipe saves a new row here and leaves that Recipe alone', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const stranger = await setupUser()
	const theirs = await createRecipe(stranger, 'Their soup')
	const ownOther = await createRecipe(session, 'Our other soup')
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(
		session,
		recipe,
		[
			...ingredients,
			{ id: theirs.ingredients[1]!.id, name: 'cream', amount: '100' },
			{ id: ownOther.ingredients[2]!.id, name: 'basil' },
		],
		[...steps, { id: theirs.instructions[0]!.id, content: 'Stir in cream.' }],
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => row.name)).toEqual([
		'Soup',
		'tomatoes',
		'onion',
		'stock',
		'cream',
		'basil',
	])
	expect(saved.ingredients[4]!.id).not.toBe(theirs.ingredients[1]!.id)
	expect(saved.ingredients[5]!.id).not.toBe(ownOther.ingredients[2]!.id)
	expect(saved.instructions[3]!.id).not.toBe(theirs.instructions[0]!.id)
	const theirsSaved = await savedRows(theirs.id)
	expect(theirsSaved.ingredients[1]).toMatchObject({
		id: theirs.ingredients[1]!.id,
		name: 'tomatoes',
		amount: '800',
	})
	expect(theirsSaved.instructions[0]).toMatchObject({
		id: theirs.instructions[0]!.id,
		content: 'Soften the onion.',
	})
	const ownOtherSaved = await savedRows(ownOther.id)
	expect(ownOtherSaved.ingredients[2]).toMatchObject({
		id: ownOther.ingredients[2]!.id,
		name: 'onion',
	})
})

test('a row deleted while the form was open is saved again as a new row', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)
	// Another member removes the onion and the last step, then this form,
	// opened before that, saves with both still on it.
	await prisma.ingredient.delete({ where: { id: ingredients[2]!.id } })
	await prisma.instruction.delete({ where: { id: steps[2]!.id } })

	await saveEdit(
		session,
		recipe,
		ingredients.map((row, index) =>
			index === 2 ? { ...row, name: 'red onion' } : row,
		),
		steps,
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => row.name)).toEqual([
		'Soup',
		'tomatoes',
		'red onion',
		'stock',
	])
	expect(saved.ingredients[2]!.id).not.toBe(ingredients[2]!.id)
	expect(saved.instructions.map((row) => row.content)).toEqual([
		'Soften the onion.',
		'Add the tomatoes and stock.',
		'Simmer for 20 minutes.',
	])
	expect(saved.instructions[2]!.id).not.toBe(steps[2]!.id)
})

test('the same id posted twice keeps it on the first row and saves the second as new', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(
		session,
		recipe,
		[...ingredients, { ...ingredients[1]!, name: 'cherry tomatoes' }],
		[...steps, { ...steps[0]!, content: 'Serve hot.' }],
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients).toHaveLength(5)
	expect(saved.ingredients[1]).toMatchObject({
		id: ingredients[1]!.id,
		name: 'tomatoes',
	})
	expect(saved.ingredients[4]!.name).toBe('cherry tomatoes')
	expect(saved.ingredients[4]!.id).not.toBe(ingredients[1]!.id)
	expect(saved.instructions).toHaveLength(4)
	expect(saved.instructions[0]!.id).toBe(steps[0]!.id)
	expect(saved.instructions[3]!.id).not.toBe(steps[0]!.id)
})

test('a linked-Recipe ingredient keeps its id and link through an unrelated edit', async () => {
	const session = await setupUser()
	const pesto = await prisma.recipe.create({
		data: {
			title: 'Pesto',
			userId: session.userId,
			householdId: session.householdId,
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Pesto pasta',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: {
				create: [
					{ name: 'pasta', amount: '200', unit: 'g', order: 0 },
					{ name: 'Pesto', linkedRecipeId: pesto.id, order: 1 },
				],
			},
			instructions: { create: { content: 'Toss together.', order: 0 } },
		},
		include: {
			ingredients: { orderBy: { order: 'asc' } },
			instructions: { orderBy: { order: 'asc' } },
		},
	})
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(
		session,
		recipe,
		ingredients.map((row, index) =>
			index === 0 ? { ...row, amount: '250' } : row,
		),
		steps,
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients[1]).toMatchObject({
		id: recipe.ingredients[1]!.id,
		name: 'Pesto',
		linkedRecipeId: pesto.id,
	})
	expect(saved.ingredients[0]).toMatchObject({
		id: recipe.ingredients[0]!.id,
		amount: '250',
	})
})

test('rows another member added while the form was open stay, after the saved rows', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)
	// Added by another member after this form loaded.
	const salt = await prisma.ingredient.create({
		data: { recipeId: recipe.id, name: 'salt', order: 4 },
	})
	const garnish = await prisma.instruction.create({
		data: { recipeId: recipe.id, content: 'Garnish with basil.', order: 3 },
	})

	// The editor removes the onion and a step, and adds a row of their own.
	await saveEdit(
		session,
		recipe,
		[...ingredients.filter((_, index) => index !== 2), { name: 'pepper' }],
		steps.slice(1),
	)

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => [row.name, row.order])).toEqual([
		['Soup', 0],
		['tomatoes', 1],
		['stock', 2],
		['pepper', 3],
		['salt', 4],
	])
	expect(saved.ingredients[4]!.id).toBe(salt.id)
	expect(saved.instructions.map((row) => [row.id, row.order])).toEqual([
		[steps[1]!.id, 0],
		[steps[2]!.id, 1],
		[garnish.id, 2],
	])
})

test('a form posted without the loaded ids still removes the rows it left out', async () => {
	const session = await setupUser()
	const recipe = await createRecipe(session)
	const { ingredients, steps } = loadedRows(recipe)

	await saveEdit(session, recipe, ingredients.slice(0, 2), steps.slice(0, 1), {
		loadedIds: [],
	})

	const saved = await savedRows(recipe.id)
	expect(saved.ingredients.map((row) => row.id)).toEqual(
		recipe.ingredients.slice(0, 2).map((row) => row.id),
	)
	expect(saved.instructions.map((row) => row.id)).toEqual([
		recipe.instructions[0]!.id,
	])
})

test('New saves the posted rows as they were and takes no posted id', async () => {
	const session = await setupUser()
	const other = await createRecipe(session, 'Existing soup')
	const response = await newAction({
		request: await post(session, '/recipes/new', [
			['title', 'Flatbread'],
			...rowFields(
				[
					{ name: 'Dough', isHeading: true },
					{
						id: other.ingredients[1]!.id,
						name: 'flour',
						amount: '300',
						unit: 'g',
						notes: 'strong',
					},
					{ name: 'water', amount: '180', unit: 'ml' },
					{ name: 'Existing soup', linkedRecipeId: other.id },
				],
				[
					{ id: other.instructions[0]!.id, content: 'Mix and knead.' },
					{ content: 'Rest for an hour.' },
				],
			),
		]),
		...routeArgs('/recipes/new'),
	})
	expect(response).toBeInstanceOf(Response)
	const location = (response as Response).headers.get('location')!
	const recipeId = location.split('/').at(-1)!

	const saved = await savedRows(recipeId)
	expect(saved.ingredients.map(({ id: _id, ...row }) => row)).toEqual([
		{
			name: 'Dough',
			amount: null,
			unit: null,
			notes: null,
			isHeading: true,
			linkedRecipeId: null,
			order: 0,
		},
		{
			name: 'flour',
			amount: '300',
			unit: 'g',
			notes: 'strong',
			isHeading: false,
			linkedRecipeId: null,
			order: 1,
		},
		{
			name: 'water',
			amount: '180',
			unit: 'ml',
			notes: null,
			isHeading: false,
			linkedRecipeId: null,
			order: 2,
		},
		{
			name: 'Existing soup',
			amount: null,
			unit: null,
			notes: null,
			isHeading: false,
			linkedRecipeId: other.id,
			order: 3,
		},
	])
	expect(saved.instructions.map(({ id: _id, ...row }) => row)).toEqual([
		{ content: 'Mix and knead.', order: 0 },
		{ content: 'Rest for an hour.', order: 1 },
	])
	expect(saved.ingredients[1]!.id).not.toBe(other.ingredients[1]!.id)
	expect(saved.instructions[0]!.id).not.toBe(other.instructions[0]!.id)
	const untouched = await savedRows(other.id)
	expect(untouched.ingredients[1]).toMatchObject({
		id: other.ingredients[1]!.id,
		name: 'tomatoes',
	})
	expect(untouched.instructions[0]).toMatchObject({
		id: other.instructions[0]!.id,
		content: 'Soften the onion.',
	})
})
