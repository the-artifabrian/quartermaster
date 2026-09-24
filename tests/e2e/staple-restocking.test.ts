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

test('tapping a Staple adds it to Next shop from a phone', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'Salt',
			canonicalKey: 'salt',
			isStaple: true,
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
			route.request().postData()?.includes('intent=add-staple-to-shop')
		) {
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
		await route.continue()
	})

	// Scoped to the row, because the button's name flips to "is in Next shop"
	// the moment it is pressed.
	const saltRow = page
		.getByRole('list', { name: 'Staples' })
		.getByRole('listitem')
		.filter({ hasText: 'Salt' })
	const saltButton = saltRow.getByRole('button').first()
	await expect(saltButton).toHaveAccessibleName('Add Salt to Next shop')
	const response = page.waitForResponse(
		(candidate) =>
			candidate.request().method() === 'POST' &&
			candidate.request().postData()?.includes('intent=add-staple-to-shop') ===
				true,
	)
	await saltButton.click()
	// The row answers for itself straight away, and keeps saying so.
	await expect(saltButton).toHaveText('On list')
	await expect(saltButton).toHaveAttribute('aria-busy', 'true')
	await response
	await expect(saltButton).toHaveAccessibleName('Salt is in Next shop')
	await expect(saltButton).toHaveText('On list')
	await expect(saltButton).toBeFocused()

	await page.getByRole('link', { name: 'Shop' }).click()
	const nextShop = page.getByTestId('next-shopping-items')
	await expect(
		nextShop.getByRole('group', { name: 'Salt shopping item' }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.householdEvent.count({
				where: {
					householdId: user.householdId,
					type: 'shopping_list_item_added',
				},
			}),
		)
		.toBe(1)
})

test('a failed restock reports it and leaves the Staple tappable', async ({
	page,
	login,
}) => {
	const user = await login()
	const staple = await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'Failure salt',
			canonicalKey: 'failure salt',
			isStaple: true,
		},
		select: { id: true },
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
		const saltRow = page
			.getByRole('list', { name: 'Staples' })
			.getByRole('listitem')
			.filter({ hasText: 'Failure salt' })
		const saltButton = saltRow.getByRole('button').first()

		await saltButton.click()

		// The failure is reported on the row that failed, not at the top of a
		// list the shopper has already scrolled past.
		await expect(
			saltRow.getByRole('alert').filter({
				hasText: 'Could not add Failure salt to Next shop. Try again.',
			}),
		).toBeVisible()
		await expect(saltButton).toHaveAccessibleName(
			'Add Failure salt to Next shop',
		)
		await expect(saltButton).not.toHaveAttribute('aria-busy')
		await expect(saltButton).toBeEnabled()
		await expect(saltButton).toBeFocused()
		// The Staple itself is untouched — a tap never changed it.
		expect(
			await prisma.householdIngredient.findUniqueOrThrow({
				where: { id: staple.id },
				select: { isStaple: true },
			}),
		).toEqual({ isStaple: true })
	} finally {
		await prisma.$executeRawUnsafe('DROP TRIGGER reject_failure_staple_restock')
	}
})
