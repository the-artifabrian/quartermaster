import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test('Inventory flow: empty state → add item → verify → edit → delete', async ({
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
	// Select location (fridge) - label not properly associated via conform, use locator
	await page.locator('select').selectOption('fridge')
	await page.getByLabel(/quantity/i).fill('2')
	await page.getByLabel(/unit \(optional\)/i).fill('lbs')

	await page.getByRole('button', { name: /add item/i }).click()

	// 3. Verify item appears in inventory
	await expect(page).toHaveURL(/\/inventory/)
	await expect(
		page.getByRole('heading', { name: 'Chicken Breast' }),
	).toBeVisible()

	// 4. Click the edit link on the item card
	await page.locator('a[href*="/edit"]').first().click()
	await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+\/edit/)

	// Edit quantity
	await page.getByLabel(/quantity/i).fill('5')
	await page.getByRole('button', { name: /save changes/i }).click()

	// 5. Verify back on inventory page
	await expect(page).toHaveURL(/\/inventory/)
	await expect(
		page.getByRole('heading', { name: 'Chicken Breast' }),
	).toBeVisible()

	// 6. Delete item via edit page
	await page.locator('a[href*="/edit"]').first().click()
	await page.getByRole('button', { name: /delete/i }).click()
	// Double-check confirmation
	await page.getByRole('button', { name: /are you sure/i }).click()

	await expect(page).toHaveURL(/\/inventory/)
	await expect(
		page.getByRole('heading', { name: 'Chicken Breast' }),
	).not.toBeVisible()
})

test('Inventory location tabs filter items', async ({ page, login }) => {
	const user = await login()

	// Create items in different locations via DB
	// Use unique names that won't collide with common ingredients quick-add buttons
	await prisma.inventoryItem.create({
		data: {
			name: 'Whole Milk',
			location: 'fridge',
			quantity: 1,
			unit: 'gallon',
			userId: user.id,
		},
	})
	await prisma.inventoryItem.create({
		data: {
			name: 'Brown Rice',
			location: 'pantry',
			quantity: 5,
			unit: 'lbs',
			userId: user.id,
		},
	})
	await prisma.inventoryItem.create({
		data: {
			name: 'Frozen Peas',
			location: 'freezer',
			quantity: 1,
			unit: 'bag',
			userId: user.id,
		},
	})

	await page.goto('/inventory')

	// All items visible by default
	await expect(page.getByText('Whole Milk')).toBeVisible()
	await expect(page.getByText('Brown Rice')).toBeVisible()
	await expect(page.getByText('Frozen Peas')).toBeVisible()

	// Filter by fridge
	await page.getByRole('link', { name: /^fridge$/i }).click()
	await expect(page).toHaveURL(/location=fridge/)
	await expect(page.getByText('Whole Milk')).toBeVisible()
	await expect(page.getByText('Brown Rice')).not.toBeVisible()
	await expect(page.getByText('Frozen Peas')).not.toBeVisible()

	// Filter by pantry
	await page.getByRole('link', { name: /^pantry$/i }).click()
	await expect(page).toHaveURL(/location=pantry/)
	await expect(page.getByText('Brown Rice')).toBeVisible()
	await expect(page.getByText('Whole Milk')).not.toBeVisible()
})
