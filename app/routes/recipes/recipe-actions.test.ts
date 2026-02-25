import { type AppLoadContext } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { loader, action } from './$recipeId.tsx'

function makeActionArgs(recipeId: string) {
	return {
		params: { recipeId },
		context: {} as AppLoadContext,
		unstable_pattern: '/recipes/:recipeId',
	}
}

async function setupUser() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: { userId: session.userId, tier: 'pro' },
	})
	return { ...session, householdId: household.id }
}

async function setupRecipe(
	userId: string,
	householdId: string,
	overrides?: { isFavorite?: boolean },
) {
	return prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			description: 'A test description',
			userId,
			householdId,
			servings: 4,
			prepTime: 10,
			cookTime: 30,
			isFavorite: overrides?.isFavorite ?? false,
			ingredients: {
				create: [
					{ name: 'flour', amount: '2', unit: 'cups', order: 0 },
					{ name: 'butter', amount: '1', unit: 'tbsp', order: 1 },
				],
			},
			instructions: {
				create: [
					{ content: 'Mix ingredients', order: 0 },
					{ content: 'Bake at 350F', order: 1 },
				],
			},
		},
	})
}

async function makeRequest(
	session: { id: string },
	recipeId: string,
	formFields: Record<string, string>,
	method: 'GET' | 'POST' = 'POST',
) {
	const cookie = await getSessionCookieHeader(session)
	if (method === 'GET') {
		return new Request(`${BASE_URL}/recipes/${recipeId}`, {
			method: 'GET',
			headers: { cookie },
		})
	}
	const formData = new URLSearchParams(formFields)
	return new Request(`${BASE_URL}/recipes/${recipeId}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formData.toString(),
	})
}

describe('recipe detail loader', () => {
	test('loads recipe with ingredients, instructions, and logs', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const request = await makeRequest(session, recipe.id, {}, 'GET')
		const result = (await loader({
			request,
			...makeActionArgs(recipe.id),
		})) as { recipe: any; cookingLogs: any[] }

		expect(result.recipe.id).toBe(recipe.id)
		expect(result.recipe.title).toBe('Test Recipe')
		expect(result.recipe.ingredients).toHaveLength(2)
		expect(result.recipe.instructions).toHaveLength(2)
		expect(result.cookingLogs).toHaveLength(0)
	})

	test('returns 404 for nonexistent recipe', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, 'nonexistent', {}, 'GET')
		const response = loader({
			request,
			...makeActionArgs('nonexistent'),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
	})

	test('returns 403 for other user recipe', async () => {
		const session1 = await setupUser()
		const session2 = await setupUser()
		const recipe = await setupRecipe(session1.userId, session1.householdId)

		const request = await makeRequest(session2, recipe.id, {}, 'GET')
		const response = loader({
			request,
			...makeActionArgs(recipe.id),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 403 }),
		)
	})
})

describe('recipe detail actions', () => {
	test('toggle favorite', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId, {
			isFavorite: false,
		})

		const request = await makeRequest(session, recipe.id, {
			intent: 'toggleFavorite',
		})
		const result = await action({ request, ...makeActionArgs(recipe.id) })
		expect(result).toEqual({ success: true })

		const updated = await prisma.recipe.findUnique({
			where: { id: recipe.id },
		})
		expect(updated!.isFavorite).toBe(true)

		// Toggle back
		const request2 = await makeRequest(session, recipe.id, {
			intent: 'toggleFavorite',
		})
		await action({ request: request2, ...makeActionArgs(recipe.id) })
		const reToggled = await prisma.recipe.findUnique({
			where: { id: recipe.id },
		})
		expect(reToggled!.isFavorite).toBe(false)
	})

	test('log cook creates cooking log', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const request = await makeRequest(session, recipe.id, {
			intent: 'logCook',
			cookedAt: '2026-02-06',
			notes: 'Turned out great!',
		})
		const result = await action({ request, ...makeActionArgs(recipe.id) })
		expect(result).toEqual({ success: true })

		const logs = await prisma.cookingLog.findMany({
			where: { recipeId: recipe.id, userId: session.userId },
		})
		expect(logs).toHaveLength(1)
		expect(logs[0]!.notes).toBe('Turned out great!')
	})

	test('delete cook log', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		// Create a cooking log
		const log = await prisma.cookingLog.create({
			data: {
				recipeId: recipe.id,
				userId: session.userId,
				cookedAt: new Date(),
			},
		})

		const request = await makeRequest(session, recipe.id, {
			intent: 'deleteCookLog',
			logId: log.id,
		})
		const result = await action({ request, ...makeActionArgs(recipe.id) })
		expect(result).toEqual({ success: true })

		const deleted = await prisma.cookingLog.findUnique({
			where: { id: log.id },
		})
		expect(deleted).toBeNull()
	})

	test('action on nonexistent recipe returns 404', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, 'nonexistent', {
			intent: 'toggleFavorite',
		})
		const response = action({
			request,
			...makeActionArgs('nonexistent'),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
	})

	test('action on other user recipe returns 403', async () => {
		const session1 = await setupUser()
		const session2 = await setupUser()
		const recipe = await setupRecipe(session1.userId, session1.householdId)

		const request = await makeRequest(session2, recipe.id, {
			intent: 'toggleFavorite',
		})
		const response = action({
			request,
			...makeActionArgs(recipe.id),
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 403 }),
		)
	})
})
