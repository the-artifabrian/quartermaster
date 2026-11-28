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

	await page.goto('/settings/profile')
	const title = page.getByRole('heading', { level: 1 })
	const group = page.getByRole('heading', { level: 3, name: 'Account' })
	const rowName = page.getByText('Two-factor auth', { exact: true })
	const rowValue = page.getByText('Off', { exact: true })
	const profileLine = page.getByRole('link', { name: user.email }).locator('p')
	const pill = page.getByText('Free', { exact: true })
	const logOut = page.getByText('Log out', { exact: true })
	const deleteAccount = page.getByRole('button', { name: 'Delete my account' })
	await hydrated(deleteAccount)
	await page.evaluate(() => document.fonts.ready)

	await expect(title).toHaveCSS('font-size', '40px')
	await expect(group).toHaveCSS('font-size', '13.5px')
	await expect(group).toHaveCSS('text-transform', 'none')
	await expect(group).toHaveCSS('letter-spacing', 'normal')
	await expect(group).toHaveCSS('font-weight', '600')
	await expect(rowName).toHaveCSS('font-size', '17px')
	await expect(rowName).toHaveCSS('font-weight', '500')
	await expect(rowValue).toHaveCSS('font-size', '16px')
	await expect(profileLine.first()).toHaveCSS('font-size', '17px')
	await expect(profileLine.last()).toHaveCSS('font-size', '13.5px')
	await expect(pill).toHaveCSS('font-size', '13.5px')
	await expect(logOut).toHaveCSS('font-size', '17px')
	await expect(deleteAccount).toHaveCSS('font-size', '16px')
	const row = (await rowName.locator('xpath=..').boundingBox())!
	expect(row.height).toBeGreaterThanOrEqual(44)
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
	await page.getByLabel('New password', { exact: true }).fill('another-pass-1')
	await page.getByLabel('Confirm new password').fill('another-pass-2')
	await change.click()
	const error = page.locator('#password-change-form li').first()
	await expect(error).toBeVisible()

	await expect(title).toHaveCSS('font-size', '28px')
	await expect(title).toHaveCSS('font-family', /Newsreader/)
	await expect(label).toHaveCSS('font-size', '13.5px')
	await expect(label).toHaveCSS('font-weight', '600')
	await expect(change).toHaveCSS('font-size', '16px')
	const changeBox = (await change.boundingBox())!
	expect(changeBox.height).toBe(48)
	const form = (await page.locator('#password-change-form').boundingBox())!
	expect(changeBox.width).toBe(form.width)
	await expect(error).toHaveCSS('font-size', '13.5px')
	// The next field's label keeps clear of the input above it.
	const firstInput = (await page.getByLabel('Current password').boundingBox())!
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

	await prisma.user.delete({ where: { id: other.id } })
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
