import { expect, test } from '#tests/playwright-utils.ts'

test('Inventory flow: empty state → add item → verify → delete', async ({
	page,
	login,
}) => {
	await login()

	// 1. Navigate to inventory (empty state should show onboarding)
	await page.goto('/inventory')
	await expect(
		page.getByRole('heading', { name: /stock your kitchen/i }),
	).toBeVisible()

	// Empty state should show pantry staples onboarding
	await expect(page.getByText(/staples you already have/i)).toBeVisible()

	// 2. Add item via the "Add Item" page
	await page.goto('/inventory/new')
	await expect(
		page.getByRole('heading', { name: /add inventory item/i }),
	).toBeVisible()

	await page.getByLabel(/item name/i).fill('Chicken Breast')

	await page.getByRole('button', { name: /add item/i }).click()

	// 3. Verify item appears in inventory
	await expect(page).toHaveURL(/\/inventory/)
	await expect(page.getByText('Chicken Breast')).toBeVisible()

	// 4. Delete item via dropdown menu
	await page.getByRole('button', { name: /more actions/i }).first().click()
	await page.getByRole('menuitem', { name: /delete/i }).click()
	// Double-check confirmation
	await page.getByRole('menuitem', { name: /are you sure/i }).click()

	await expect(page).toHaveURL(/\/inventory/)
	await expect(page.getByText('Chicken Breast')).not.toBeVisible()
})
