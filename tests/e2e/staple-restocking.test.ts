import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function waitForStaplesHydration(page: Page) {
	const addButton = page.getByRole('button', { name: 'Add Staple' })
	const addInput = page.getByRole('textbox', { name: 'Add a Staple' })
	await expect(async () => {
		if (!(await addInput.isVisible())) await addButton.click()
		await expect(addInput).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15_000 })
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(addInput).toBeHidden()
}

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
	await waitForStaplesHydration(page)
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
		name: 'Mark Salt available',
	})
	await expect(optimisticOutButton).toHaveAttribute('aria-busy', 'true')
	await expect(optimisticOutButton).toHaveAttribute('aria-disabled', 'true')
	await expect(optimisticOutButton).toBeFocused()
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
		await waitForStaplesHydration(page)
		const outButton = page.getByRole('button', {
			name: 'Mark Failure salt Out',
		})

		await outButton.click()

		await expect(
			page.getByRole('alert').filter({
				hasText: 'Could not mark Failure salt Out. Try again.',
			}),
		).toBeVisible()
		await expect(outButton).not.toHaveAttribute('aria-busy')
		await expect(outButton).toBeEnabled()
		await expect(outButton).toBeFocused()
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
