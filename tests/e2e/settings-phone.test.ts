import { type Page } from '@playwright/test'
import { getPasswordHash } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

// A 390px layout beside the test browser's 15px scrollbar.
test.use({ viewport: { width: 405, height: 844 }, hasTouch: true })

/** Every font size of text and fields inside the page's main area. */
async function sizesInMain(page: Page) {
	return page.evaluate(() => {
		const found = new Map<string, string>()
		const main = document.querySelector('#main-content')!
		const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const el = node.parentElement
			if (!el || !node.textContent?.trim()) continue
			const box = el.getBoundingClientRect()
			if (!box.width || !box.height) continue
			found.set(getComputedStyle(el).fontSize, node.textContent.trim())
		}
		return [...found.keys()].sort()
	})
}

// A second member, so the owner's page lists someone to remove, and an open
// invite with its Copy link and Revoke.
async function seedHousehold(user: { id: string; householdId: string }) {
	const other = await prisma.user.create({
		data: {
			username: `other_${user.id}`.slice(0, 20),
			email: `other-${user.id}@example.com`,
			name: 'Dana Second',
			roles: { connect: { name: 'user' } },
			password: { create: { hash: await getPasswordHash('other-password') } },
		},
		select: { id: true },
	})
	await prisma.householdMember.create({
		data: { householdId: user.householdId, userId: other.id, role: 'member' },
	})
	await prisma.householdInvite.create({
		data: {
			token: `sizes${user.id}`,
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			householdId: user.householdId,
			createdById: user.id,
		},
	})
	return other
}

test('Settings reads in its phone sizes up to 767px and in the wider sizes from 768px', async ({
	page,
	login,
}) => {
	const user = await login({ password: 'settings-sizes-1' })
	const other = await seedHousehold(user)
	try {
		await page.goto('/settings/profile')
		const title = page.getByRole('heading', { level: 1 })
		const group = page.getByRole('heading', { level: 3, name: 'Account' })
		const rowName = page.getByText('Two-factor auth', { exact: true })
		const rowValue = page.getByText('Off', { exact: true })
		const profileLine = page
			.getByRole('link', { name: user.email })
			.locator('p')
		const pill = page.getByText('Free', { exact: true })
		const logOut = page.getByText('Log out', { exact: true })
		const deleteAccount = page.getByRole('button', {
			name: 'Delete my account',
		})
		await hydrated(deleteAccount)
		await page.evaluate(() => document.fonts.ready)

		await expect(group).toHaveCSS('font-size', '13.5px')
		await expect(group).toHaveCSS('text-transform', 'none')
		await expect(group).toHaveCSS('letter-spacing', 'normal')
		await expect(rowName).toHaveCSS('font-size', '17px')
		await expect(rowName).toHaveCSS('font-weight', '500')
		await expect(rowValue).toHaveCSS('font-size', '16px')
		await expect(profileLine.first()).toHaveCSS('font-size', '17px')
		await expect(profileLine.last()).toHaveCSS('font-size', '13.5px')
		await expect(pill).toHaveCSS('font-size', '13.5px')
		await expect(logOut).toHaveCSS('font-size', '17px')
		await expect(deleteAccount).toHaveCSS('font-size', '16px')
		// The big initial is the one other size on the page.
		expect(await sizesInMain(page)).toEqual(
			['13.5px', '16px', '17px', '20px', '40px'].sort(),
		)

		await page.setViewportSize({ width: 767, height: 844 })
		await expect(group).toHaveCSS('font-size', '13.5px')
		await expect(rowName).toHaveCSS('font-size', '17px')

		await page.setViewportSize({ width: 768, height: 844 })
		await expect(group).toHaveCSS('font-size', '12px')
		await expect(group).toHaveCSS('text-transform', 'uppercase')
		await expect(rowName).toHaveCSS('font-size', '16px')
		await expect(rowName).toHaveCSS('font-weight', '400')
		await expect(rowValue).toHaveCSS('font-size', '14px')
		await expect(profileLine.last()).toHaveCSS('font-size', '14px')
		await expect(pill).toHaveCSS('font-size', '12px')
		await expect(logOut).toHaveCSS('font-size', '16px')
		await expect(deleteAccount).toHaveCSS('font-size', '14px')

		// A pushed page: its title, a field's label, the one button, an error.
		await page.setViewportSize({ width: 405, height: 844 })
		await page.goto('/settings/profile/password')
		const label = page.getByText('Current password', { exact: true })
		const change = page.getByRole('button', { name: 'Change password' })
		await hydrated(change)
		await page.evaluate(() => document.fonts.ready)
		await page.getByLabel('Current password').fill('settings-sizes-1')
		await page
			.getByLabel('New password', { exact: true })
			.fill('another-pass-1')
		await page.getByLabel('Confirm new password').fill('another-pass-2')
		await change.click()
		const error = page.locator('#password-change-form li').first()
		await expect(error).toBeVisible()

		await expect(title).toHaveCSS('font-size', '28px')
		await expect(label).toHaveCSS('font-size', '13.5px')
		await expect(label).toHaveCSS('font-weight', '600')
		await expect(change).toHaveCSS('font-size', '16px')
		const changeBox = (await change.boundingBox())!
		expect(changeBox.height).toBe(48)
		const form = (await page.locator('#password-change-form').boundingBox())!
		expect(changeBox.width).toBeCloseTo(form.width, 0)
		await expect(error).toHaveCSS('font-size', '13.5px')
		// The next field's label keeps clear of the input above it.
		const firstInput = (await page
			.getByLabel('Current password')
			.boundingBox())!
		const nextLabel = (await page
			.getByText('New password', { exact: true })
			.boundingBox())!
		expect(nextLabel.y - (firstInput.y + firstInput.height)).toBe(16)

		await page.setViewportSize({ width: 768, height: 844 })
		await expect(title).toHaveCSS('font-size', '24px')
		await expect(label).toHaveCSS('font-size', '14px')
		await expect(change).toHaveCSS('font-size', '14px')
		expect((await change.boundingBox())!.height).toBe(44)
		await expect(error).toHaveCSS('font-size', '14px')

		// The Household: serif section headings, names and their small lines, a
		// full-size button at 16px and the small ones at 14px.
		await page.setViewportSize({ width: 405, height: 844 })
		await page.goto('/settings/profile/household')
		const section = page.getByRole('heading', { level: 3, name: 'Members' })
		const member = page.getByText('Dana Second', { exact: true })
		const memberLine = page.getByText(/· member$/)
		const rename = page.getByRole('button', { name: 'Rename' })
		const remove = page.getByRole('button', { name: 'Remove' })
		const copy = page.getByRole('button', { name: 'Copy link' })
		await hydrated(rename)
		await page.evaluate(() => document.fonts.ready)

		await expect(section).toHaveCSS('font-size', '24px')
		await expect(section).toHaveCSS('font-family', /Newsreader/)
		await expect(member).toHaveCSS('font-size', '17px')
		await expect(memberLine).toHaveCSS('font-size', '13.5px')
		await expect(page.getByText(/^Expires /)).toHaveCSS('font-size', '13.5px')
		await expect(rename).toHaveCSS('font-size', '16px')
		await expect(remove).toHaveCSS('font-size', '14px')
		await expect(copy).toHaveCSS('font-size', '14px')
		// The small buttons are the shared control's own 14px.
		expect(await sizesInMain(page)).toEqual(
			['13.5px', '14px', '16px', '17px', '24px', '28px'].sort(),
		)

		await page.setViewportSize({ width: 768, height: 844 })
		await expect(section).toHaveCSS('font-size', '16px')
		await expect(section).toHaveCSS('font-family', /Schibsted Grotesk/)
		await expect(member).toHaveCSS('font-size', '16px')
		await expect(memberLine).toHaveCSS('font-size', '14px')
		await expect(rename).toHaveCSS('font-size', '14px')
	} finally {
		await prisma.user.delete({ where: { id: other.id } })
	}
})

test('the words beside a checkbox are 16px in ink on a phone, and a field’s label is small and muted', async ({
	page,
}) => {
	await page.goto('/login')
	const remember = page.getByText('Remember me', { exact: true })
	const label = page.getByText('Username', { exact: true })
	await hydrated(page.getByRole('button', { name: 'Log in', exact: true }))
	const ink = await page.evaluate(() => getComputedStyle(document.body).color)

	await expect(remember).toHaveCSS('font-size', '16px')
	await expect(remember).toHaveCSS('color', ink)
	await expect(label).toHaveCSS('font-size', '13.5px')
	await expect(label).not.toHaveCSS('color', ink)

	await page.setViewportSize({ width: 768, height: 844 })
	await expect(remember).toHaveCSS('font-size', '14px')
	await expect(remember).not.toHaveCSS('color', ink)
	await expect(label).toHaveCSS('font-size', '14px')
	await expect(label).toHaveCSS('color', ink)
})

test('small buttons keep 14px on a phone and full-size ones read at 16px', async ({
	page,
	login,
}) => {
	// Signed out: the header's button is small, About's own is full size.
	await page.goto('/about')
	const header = page.getByRole('banner').getByRole('link', { name: 'Log in' })
	const getStarted = page.getByRole('link', { name: 'Get started' })
	await hydrated(getStarted)
	await expect(header).toHaveCSS('font-size', '14px')
	await expect(getStarted).toHaveCSS('font-size', '16px')

	const user = await login()
	const other = await seedHousehold(user)
	const elsewhere = await prisma.household.create({
		data: {
			name: 'Elsewhere',
			members: { create: { userId: other.id, role: 'owner' } },
			invites: {
				create: {
					token: `join${user.id}`,
					expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
					createdById: other.id,
				},
			},
		},
		select: { id: true },
	})
	try {
		await prisma.householdIngredient.create({
			data: {
				displayName: 'Salt',
				canonicalKey: 'salt',
				isStaple: true,
				householdId: user.householdId,
			},
		})
		await prisma.shoppingList.create({
			data: {
				userId: user.id,
				householdId: user.householdId,
				items: {
					create: [
						{ name: 'Milk' },
						{ name: 'Candles', horizon: 'later', checked: true },
					],
				},
			},
		})

		await page.goto('/staples')
		const need = page.getByRole('button', { name: 'Need, Salt' })
		await hydrated(need)
		await expect(need).toHaveCSS('font-size', '14px')

		await page.goto('/shopping')
		const later = page.getByRole('button', { name: /Later/ })
		await hydrated(later)
		await later.click()
		await expect(
			page.getByRole('button', { name: 'Clear checked items from Later' }),
		).toHaveCSS('font-size', '14px')

		await page.goto(`/household/join?token=join${user.id}`)
		const accept = page.getByRole('button', { name: 'Accept' })
		await hydrated(accept)
		await expect(accept).toHaveCSS('font-size', '14px')

		// A full-size button's icon keeps its 14px beside the 16px label.
		await page.goto('/settings/profile/household')
		const generate = page.getByRole('button', { name: 'Generate invite link' })
		await hydrated(generate)
		await expect(generate).toHaveCSS('font-size', '16px')
		await expect(generate.locator('svg')).toHaveCSS('width', '14px')

		await page.goto('/settings/profile')
		const deleteAccount = page.getByRole('button', {
			name: 'Delete my account',
		})
		await hydrated(deleteAccount)
		await expect(deleteAccount.locator('svg')).toHaveCSS('width', '14px')
		await deleteAccount.click()
		const sheet = page.getByRole('dialog')
		await expect(
			sheet.getByRole('button', { name: 'Delete account' }),
		).toHaveCSS('font-size', '14px')
		await expect(sheet.getByRole('button', { name: 'Cancel' })).toHaveCSS(
			'font-size',
			'14px',
		)

		// From 640px a tab's round add button shows its words, still small.
		await page.setViewportSize({ width: 715, height: 844 })
		await page.goto('/recipes')
		const newRecipe = page.getByRole('button', { name: 'New Recipe' })
		await hydrated(newRecipe)
		await expect(newRecipe).toHaveCSS('font-size', '14px')
	} finally {
		await prisma.household.delete({ where: { id: elsewhere.id } })
		await prisma.user.delete({ where: { id: other.id } })
	}
})
