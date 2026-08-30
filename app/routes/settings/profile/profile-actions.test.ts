import { RouterContextProvider } from 'react-router'
import { describe, expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action } from './index.tsx'

const ACTION_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/settings/profile',
	url: new URL(`${BASE_URL}/settings/profile`),
}

describe('profile actions', () => {
	test('deleting a plan creator preserves the shared household plan', async () => {
		const { session, creator, survivor, household, recipe, mealPlan } =
			await prisma.$transaction(async (tx) => {
				const session = await tx.session.create({
					data: {
						expirationDate: getSessionExpirationDate(),
						user: { create: createUser() },
					},
					include: { user: true },
				})
				const survivor = await tx.user.create({ data: createUser() })
				const household = await tx.household.create({
					data: {
						name: 'Shared Household',
						members: {
							create: [
								{ userId: session.userId, role: 'owner' },
								{ userId: survivor.id, role: 'member' },
							],
						},
					},
				})
				const recipe = await tx.recipe.create({
					data: {
						title: 'Survivor Dinner',
						userId: survivor.id,
						householdId: household.id,
					},
				})
				const mealPlan = await tx.mealPlan.create({
					data: {
						householdId: household.id,
						weekStart: new Date('2026-02-02T00:00:00.000Z'),
						meals: {
							create: {
								date: new Date('2026-02-02T00:00:00.000Z'),
								order: 0,
								label: 'dinner',
								recipeItems: {
									create: {
										order: 0,
										recipeId: recipe.id,
										recipeTitle: 'Survivor Dinner',
										scaleMultiplier: 1,
									},
								},
							},
						},
					},
				})
				return {
					session,
					creator: session.user,
					survivor,
					household,
					recipe,
					mealPlan,
				}
			})

		const cookie = await getSessionCookieHeader(session)
		const response = await action({
			request: new Request(`${BASE_URL}/settings/profile`, {
				method: 'POST',
				headers: {
					cookie,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({ intent: 'delete-data' }),
			}),
			...ACTION_ARGS_BASE,
		})

		expect(response).toBeInstanceOf(Response)
		await expect(
			prisma.user.findUnique({ where: { id: creator.id } }),
		).resolves.toBeNull()
		await expect(
			prisma.household.findUnique({ where: { id: household.id } }),
		).resolves.not.toBeNull()
		await expect(
			prisma.user.findUnique({ where: { id: survivor.id } }),
		).resolves.not.toBeNull()
		await expect(
			prisma.recipe.findUnique({ where: { id: recipe.id } }),
		).resolves.not.toBeNull()
		await expect(
			prisma.mealPlan.findUnique({ where: { id: mealPlan.id } }),
		).resolves.toEqual(expect.objectContaining({ id: mealPlan.id }))
		await expect(
			prisma.meal.count({ where: { mealPlanId: mealPlan.id } }),
		).resolves.toBe(1)
	})
})
