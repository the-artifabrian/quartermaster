import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// What the upgrade page offers each visitor while Pro isn't on sale (Stripe
// is off, as in production and in this suite).
//
// Failure list:
// - a logged-out visitor sees a dead "Coming Soon" button and no way to try Pro
// - the way to try Pro posts somewhere other than /demo, or loses the page
//   it was on, so a "demo is full" toast lands somewhere else
// - a signed-in user is pointed at the demo, which can't start while they're
//   signed in
// - a trialing user sees "Current" on both cards, since they're on Free's
//   account and on Pro's features at once
// - a free user sees "Current" on Pro, or on neither card
// - the Free card still promises "Unlimited Recipes", a cap that doesn't exist

const NOT_ON_SALE = "Pro isn't on sale."
const TRY_IN_DEMO =
	"Pro isn't on sale. The demo runs as Pro, so you can try everything there."

function card(page: Page, name: 'Free' | 'Pro') {
	return page.getByRole('main').locator('div.rounded-lg', {
		has: page.getByRole('heading', { level: 2, name, exact: true }),
	})
}

function currentButtons(page: Page) {
	return page
		.getByRole('main')
		.getByRole('button', { name: 'Current', exact: true })
}

test('a visitor learns Pro is not on sale and can try it in the demo', async ({
	page,
}) => {
	await page.goto('/upgrade')
	const pro = card(page, 'Pro')
	await expect(pro.getByText(TRY_IN_DEMO, { exact: true })).toBeVisible()
	const demo = pro.locator('form', {
		has: page.getByRole('button', { name: 'Try the demo' }),
	})
	await expect(demo).toHaveAttribute('action', '/demo')
	await expect(demo.locator('input[name="redirectTo"]')).toHaveValue('/upgrade')
	await expect(page.getByText('Coming Soon')).toHaveCount(0)
	await expect(currentButtons(page)).toHaveCount(0)
	await expect(page.getByText(/Unlimited/)).toHaveCount(0)
})

test('a free user has Free as current and no pointer to the demo', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/upgrade')
	await expect(currentButtons(page)).toHaveCount(1)
	await expect(card(page, 'Free').getByRole('button')).toHaveText('Current')
	const pro = card(page, 'Pro')
	await expect(pro.getByText(NOT_ON_SALE, { exact: true })).toBeVisible()
	await expect(pro.getByRole('button', { name: 'Try the demo' })).toHaveCount(0)
	await expect(page.getByText(/demo/i)).toHaveCount(0)
})

test('a trialing user has only Pro as current', async ({ page, login }) => {
	const user = await login()
	await prisma.subscription.create({
		data: {
			userId: user.id,
			tier: 'free',
			trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
		},
	})
	await page.goto('/upgrade')
	await expect(currentButtons(page)).toHaveCount(1)
	await expect(card(page, 'Pro').getByRole('button')).toHaveText('Current')
	await expect(card(page, 'Free').getByRole('button')).toHaveCount(0)
})
