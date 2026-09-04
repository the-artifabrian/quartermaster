import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const PHONE_VIEWPORT = { width: 390, height: 844 }

async function expectMobileEditableControlsToBeSafe(page: Page) {
	// A role query cannot enumerate every native editable control for this
	// computed-style audit, especially controls without an accessible name.
	// eslint-disable-next-line playwright/no-raw-locators
	const audit = await page
		.locator('input, textarea, select')
		.evaluateAll((elements) =>
			elements.flatMap((element) => {
				const textInputTypes = new Set([
					'text',
					'search',
					'email',
					'password',
					'tel',
					'url',
					'number',
					'date',
					'datetime-local',
					'month',
					'time',
					'week',
					'file',
				])
				const isEditable =
					element instanceof HTMLSelectElement ||
					element instanceof HTMLTextAreaElement ||
					(element instanceof HTMLInputElement &&
						textInputTypes.has(element.type))
				if (!isEditable || !element.matches(':enabled')) return []
				if (
					(element instanceof HTMLInputElement ||
						element instanceof HTMLTextAreaElement) &&
					element.readOnly
				) {
					return []
				}

				const style = getComputedStyle(element)
				const rect = element.getBoundingClientRect()
				if (
					style.display === 'none' ||
					style.visibility === 'hidden' ||
					rect.width === 0 ||
					rect.height === 0
				) {
					return []
				}

				return [
					{
						control: [
							element.tagName.toLowerCase(),
							element.id ? `#${element.id}` : '',
							element.getAttribute('name')
								? `[name="${element.getAttribute('name')}"]`
								: '',
							element.getAttribute('placeholder')
								? `[placeholder="${element.getAttribute('placeholder')}"]`
								: '',
						].join(''),
						fontSize: Number.parseFloat(style.fontSize),
						left: rect.left,
						right: rect.right,
					},
				]
			}),
		)

	expect(audit.length).toBeGreaterThan(0)
	const viewportWidth = page.viewportSize()?.width
	expect(viewportWidth).toBeDefined()
	expect(
		audit.filter(
			(control) =>
				control.fontSize < 16 ||
				control.left < -0.5 ||
				control.right > viewportWidth! + 0.5,
		),
	).toEqual([])
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true)
}

async function expectFocusKeepsActionReachable(
	page: Page,
	control: Locator,
	action: Locator,
) {
	await control.focus()
	await expect(control).toBeFocused()
	await expect(action).toBeVisible()

	const actionBox = await action.boundingBox()
	expect(actionBox).not.toBeNull()
	const visualViewport = await page.evaluate(() => ({
		left: window.visualViewport?.offsetLeft ?? 0,
		width: window.visualViewport?.width ?? window.innerWidth,
		scale: window.visualViewport?.scale ?? 1,
	}))
	// Chromium makes this deterministic layout evidence; iOS alone can confirm
	// whether the operating system refrains from magnifying a focused control.
	expect(visualViewport.scale).toBe(1)
	expect(actionBox!.x).toBeGreaterThanOrEqual(visualViewport.left)
	expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
		visualViewport.left + visualViewport.width,
	)
}

async function createHousehold(userId: string) {
	const household = await prisma.household.create({
		data: {
			name: 'Mobile controls household',
			staplesCutoverAt: new Date(),
			members: { create: { userId, role: 'owner' } },
			householdIngredients: {
				create: {
					displayName: 'Milk',
					canonicalKey: 'milk',
					isStaple: true,
				},
			},
		},
	})
	await prisma.subscription.create({
		data: {
			userId,
			tier: 'pro',
			trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		},
	})
	await prisma.shoppingList.create({
		data: { userId, householdId: household.id },
	})
	await prisma.recipe.create({
		data: {
			title: 'Mobile Test Recipe',
			userId,
			householdId: household.id,
		},
	})
	return household
}

test('mobile Shopping add controls stay zoom-safe and keep Add reachable', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await createHousehold(user.id)
	await page.setViewportSize(PHONE_VIEWPORT)
	await page.goto('/shopping')
	await page.getByRole('button', { name: 'Add item' }).click()

	const item = page.getByPlaceholder('Add an item...').filter({ visible: true })
	const add = page.getByRole('button', { name: 'Add to Next shop' })
	await expectFocusKeepsActionReachable(page, item, add)
	await page.getByRole('button', { name: '+ Qty & unit' }).click()

	const quantity = page.getByPlaceholder('Qty').filter({ visible: true })
	const unit = page.getByPlaceholder('Unit').filter({ visible: true })
	for (const control of [item, quantity, unit]) {
		await expectFocusKeepsActionReachable(page, control, add)
	}
	await expectMobileEditableControlsToBeSafe(page)

	await item.fill('Apples')
	await quantity.fill('2')
	await unit.fill('kg')
	const addResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' &&
			response.url().includes('/shopping') &&
			response.request().postData()?.includes('intent=add') === true,
	)
	await add.click()
	expect((await addResponse).ok()).toBe(true)
	await expect(page.getByText('Apples', { exact: true })).toBeVisible()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findFirst({
				where: { name: 'Apples', list: { householdId: household.id } },
				select: { name: true, quantity: true, unit: true },
			}),
		)
		.toEqual({ name: 'Apples', quantity: '2', unit: 'kg' })
})

test('mobile auth, Recipes, Staples, Plan, and settings controls are zoom-safe', async ({
	page,
	login,
}) => {
	await page.setViewportSize(PHONE_VIEWPORT)
	await page.goto('/login')
	await expectMobileEditableControlsToBeSafe(page)

	const user = await login()
	await createHousehold(user.id)

	await page.goto('/settings/profile/edit')
	await expectMobileEditableControlsToBeSafe(page)

	await page.goto('/recipes')
	await page.getByRole('button', { name: 'Toggle filters' }).click()
	await expectMobileEditableControlsToBeSafe(page)

	await page.goto('/recipes/import')
	await expectMobileEditableControlsToBeSafe(page)
	await page.getByRole('button', { name: 'From Text' }).click()
	await expectMobileEditableControlsToBeSafe(page)
	await page.getByRole('button', { name: 'From Image' }).click()
	await expectMobileEditableControlsToBeSafe(page)

	await page.goto('/recipes/quick')
	await expectMobileEditableControlsToBeSafe(page)

	await page.goto('/inventory')
	await expectMobileEditableControlsToBeSafe(page)

	await page.goto('/settings/profile/import')
	await expectMobileEditableControlsToBeSafe(page)

	await page.goto('/plan')
	await page
		.getByRole('button', { name: /Add Meal to/ })
		.filter({ visible: true })
		.first()
		.click()
	await expectMobileEditableControlsToBeSafe(page)
})

test('the mobile size adjustment ends below md without restricting user zoom', async ({
	page,
	login,
}) => {
	const user = await login()
	await createHousehold(user.id)

	await page.setViewportSize({ width: 767, height: 844 })
	await page.goto('/recipes')
	await page.getByRole('button', { name: 'Toggle filters' }).click()
	await expect(page.getByPlaceholder('Search recipes...')).toHaveCSS(
		'font-size',
		'16px',
	)
	await expect(page.getByRole('combobox', { name: 'Sort recipes' })).toHaveCSS(
		'font-size',
		'16px',
	)

	await page.setViewportSize({ width: 768, height: 844 })
	await expect(page.getByPlaceholder('Search recipes...')).toHaveCSS(
		'font-size',
		'14px',
	)
	await expect(page.getByRole('combobox', { name: 'Sort recipes' })).toHaveCSS(
		'font-size',
		'12px',
	)

	// Metadata has no accessibility role, so a raw locator is appropriate here.
	// eslint-disable-next-line playwright/no-raw-locators
	const viewportContent = await page
		.locator('meta[name="viewport"]')
		.getAttribute('content')
	expect(viewportContent).toContain('width=device-width')
	expect(viewportContent).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/i)
})
