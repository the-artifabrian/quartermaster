import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action, loader } from './share.$recipeId.tsx'
import '#tests/setup/db-setup.ts'

async function household() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
	})
	const home = await prisma.household.create({
		data: {
			name: 'Disposable household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	return { ...session, householdId: home.id }
}

async function setup() {
	const source = await household()
	const target = await household()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Lemon chickpeas',
			userId: source.userId,
			householdId: source.householdId,
			ingredients: { create: { name: 'chickpeas', order: 0 } },
		},
		select: { id: true },
	})
	return { source, target, recipeId: recipe.id }
}

async function args(recipeId: string, session: { id: string }, post = false) {
	const url = new URL(`${BASE_URL}/share/${recipeId}`)
	return {
		params: { recipeId },
		context: new RouterContextProvider(),
		pattern: '/share/:recipeId',
		url,
		request: new Request(url, {
			method: post ? 'POST' : 'GET',
			headers: { cookie: await getSessionCookieHeader(session) },
		}),
	}
}

function redirectedId(response: unknown) {
	expect(response).toBeInstanceOf(Response)
	expect((response as Response).status).toBe(302)
	return (response as Response).headers.get('location')!.split('/').at(-1)!
}

const save = async (recipeId: string, session: { id: string }) =>
	redirectedId(await action(await args(recipeId, session, true)))

const alreadySaved = async (recipeId: string, session: { id: string }) =>
	(await loader(await args(recipeId, session))).alreadySaved

const recipesIn = (householdId: string) =>
	prisma.recipe.findMany({
		where: { householdId },
		select: { id: true, title: true, copiedFromRecipeId: true },
		orderBy: { createdAt: 'asc' },
	})

test('a Household Recipe with the same title does not stop the save', async () => {
	const { target, recipeId } = await setup()
	const own = await prisma.recipe.create({
		data: {
			title: 'Lemon chickpeas',
			userId: target.userId,
			householdId: target.householdId,
		},
		select: { id: true },
	})
	expect(await alreadySaved(recipeId, target)).toBe(false)

	const copyId = await save(recipeId, target)

	expect(copyId).not.toBe(own.id)
	expect(await recipesIn(target.householdId)).toEqual([
		{ id: own.id, title: 'Lemon chickpeas', copiedFromRecipeId: null },
		{ id: copyId, title: 'Lemon chickpeas', copiedFromRecipeId: recipeId },
	])
})

test('saving the same shared Recipe again opens the first copy', async () => {
	const { target, recipeId } = await setup()
	const first = await save(recipeId, target)
	expect(await alreadySaved(recipeId, target)).toBe(true)

	expect(await save(recipeId, target)).toBe(first)
	expect(await recipesIn(target.householdId)).toHaveLength(1)
})

test('a renamed copy still counts as saved', async () => {
	const { target, recipeId } = await setup()
	const first = await save(recipeId, target)
	await prisma.recipe.update({
		where: { id: first },
		data: { title: 'Our chickpeas' },
	})

	expect(await alreadySaved(recipeId, target)).toBe(true)
	expect(await save(recipeId, target)).toBe(first)
})

test('a shared Recipe from your own Household opens the Recipe itself', async () => {
	const { source, recipeId } = await setup()

	expect(await alreadySaved(recipeId, source)).toBe(true)
	expect(await save(recipeId, source)).toBe(recipeId)
	expect(await recipesIn(source.householdId)).toHaveLength(1)
})

test('two saves at once make one copy', async () => {
	const { target, recipeId } = await setup()

	const [a, b] = await Promise.all([
		save(recipeId, target),
		save(recipeId, target),
	])

	expect(a).toBe(b)
	expect(await recipesIn(target.householdId)).toHaveLength(1)
})

test('deleting the source keeps the copy', async () => {
	const { target, recipeId } = await setup()
	const copyId = await save(recipeId, target)

	await prisma.recipe.delete({ where: { id: recipeId } })

	expect(await recipesIn(target.householdId)).toEqual([
		{ id: copyId, title: 'Lemon chickpeas', copiedFromRecipeId: recipeId },
	])
})
