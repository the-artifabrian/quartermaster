import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('marking a Staple Out adds it to Next shop from a phone', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Phone Restocking Household',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
			householdIngredients: {
				create: {
					displayName: 'Salt',
					canonicalKey: 'salt',
					isStaple: true,
				},
			},
		},
	})
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/inventory')
	await page.route('**/inventory*', async (route) => {
		if (
			route.request().method() === 'POST' &&
			route.request().postData()?.includes('intent=toggle-staple-out')
		) {
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
		await route.continue()
	})

	const outButton = page.getByRole('button', { name: 'Mark Salt Out' })
	const response = page.waitForResponse(
		(candidate) =>
			candidate.request().method() === 'POST' &&
			candidate.request().postData()?.includes('intent=toggle-staple-out') ===
				true,
	)
	await outButton.click()
	const optimisticOutButton = page.getByRole('button', {
		name: 'Mark Salt not Out',
	})
	await expect(optimisticOutButton).toHaveAttribute('aria-pressed', 'true')
	await expect(optimisticOutButton).toBeDisabled()
	await response
	await expect(
		page
			.getByRole('status')
			.filter({ hasText: 'Salt was added to Next shop.' }),
	).toBeVisible()

	await page.getByRole('link', { name: 'Shop' }).click()
	const nextShop = page.getByTestId('next-shopping-items')
	await expect(
		nextShop.getByRole('group', { name: 'Salt shopping item' }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.householdEvent.count({
				where: {
					householdId: household.id,
					type: 'shopping_list_item_added',
				},
			}),
		)
		.toBe(1)
})

test('a failed restock rolls the optimistic Out state back with an alert', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Failed Restocking Household',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
			householdIngredients: {
				create: {
					displayName: 'Failure salt',
					canonicalKey: 'failure salt',
					isStaple: true,
				},
			},
		},
		select: { householdIngredients: { select: { id: true } } },
	})
	await prisma.$executeRawUnsafe(`
		CREATE TRIGGER reject_failure_staple_restock
		BEFORE INSERT ON "ShoppingListItem"
		WHEN NEW.name = 'Failure salt'
		BEGIN
			SELECT RAISE(ABORT, 'simulated shopping failure');
		END
	`)

	try {
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto('/inventory')
		const outButton = page.getByRole('button', {
			name: 'Mark Failure salt Out',
		})

		await outButton.click()

		await expect(
			page.getByRole('alert').filter({
				hasText: 'Could not mark Failure salt Out. Try again.',
			}),
		).toBeVisible()
		await expect(outButton).toHaveAttribute('aria-pressed', 'false')
		await expect(outButton).toBeEnabled()
		expect(
			await prisma.householdIngredient.findUniqueOrThrow({
				where: { id: household.householdIngredients[0]!.id },
				select: { isOut: true },
			}),
		).toEqual({ isOut: false })
	} finally {
		await prisma.$executeRawUnsafe('DROP TRIGGER reject_failure_staple_restock')
	}
})
