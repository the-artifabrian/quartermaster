// What a demo visitor sees: the "Try the demo" buttons, the banner on every
// app page, and the Settings and Upgrade pages without what the demo can't do.
//
// Failure list:
// - "Try the demo" posts to /demo without an intent, with the page it is on as
//   `redirectTo`, so a "demo is full" toast lands back there; the login page
//   keeps its own search (an invite link) in it
// - a second tap while the copy is being made posts again: the button is busy
//   and disabled until the answer comes
// - the banner's first paint is wrong when the browser's clock is off: it
//   must show the server's time left, with no hydration error
// - the banner stops at its first reading: it must count down without a
//   reload
// - time runs out with the page open: the banner says the demo has ended and
//   still offers Sign up; the page asks the server once, not on every tick
// - Sign up goes straight to /signup, which bounces a signed-in user: it must
//   end the demo first (`intent=end`)
// - Settings offers the account, Household and backup restore rows the demo
//   blocks, or shows the demo's .invalid email
// - Upgrade offers checkout to a demo user, or says nothing about why not
// - a real user sees the banner, the demo line in Settings, or the demo note on
//   Upgrade
import { type Page, type Request } from '@playwright/test'
import { deleteAccount } from '#app/utils/account-deletion.server.ts'
import { serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDemoCopy } from '#app/utils/demo.server.ts'
import { SAMPLE_HOUSEHOLD } from '#app/utils/sample-household-data.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { sessionKey } from '#app/utils/auth.server.ts'
import {
	browserToday,
	expect,
	hydrated,
	test as base,
} from '#tests/playwright-utils.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const test = base.extend<{
	/** Signs in a fresh demo user with a copy of the sample Household. */
	signInDemoUser: () => Promise<{ id: string }>
}>({
	signInDemoUser: async ({ page, login }, use) => {
		const ids: Array<string> = []
		await use(async () => {
			const copy = await createDemoCopy(prisma, {
				today: serializeDate(browserToday()),
			})
			if (!copy.ok) throw new Error(`No demo copy: ${copy.reason}`)
			ids.push(copy.userId)
			await login({ id: copy.userId })
			return { id: copy.userId }
		})
		// The page goes first, so nothing still loads the rows being deleted.
		await page.close()
		for (const id of ids) await deleteAccount(id).catch(() => {})
	},
})

/** The user the page's session cookie belongs to, if any. */
async function signedInUserId(page: Page) {
	const cookies = await page.context().cookies()
	const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
	const session = await authSessionStorage.getSession(header)
	const sessionId = session.get(sessionKey)
	if (!sessionId) return null
	const row = await prisma.session.findUnique({
		where: { id: sessionId },
		select: { userId: true },
	})
	return row?.userId ?? null
}

function banner(page: Page) {
	return page.getByRole('region', { name: 'Demo' })
}

function postedFields(request: Request) {
	return Object.fromEntries(new URLSearchParams(request.postData() ?? ''))
}

test.describe('starting a demo', () => {
	// Switch these on once POST /demo is on master (#440, slice 2).
	test.fixme('Try the demo on the homepage opens the app with the sample Recipes', async ({
		page,
	}) => {
		await page.goto('/')
		await hydrated(page.getByRole('button', { name: 'Try the demo' }))
		await page.getByRole('button', { name: 'Try the demo' }).click()

		await expect(page).toHaveURL(/\/recipes/)
		await expect(banner(page)).toBeVisible()
		const main = page.getByRole('main')
		await expect(
			main.getByText(SAMPLE_HOUSEHOLD.recipes[0]!.title, { exact: true }),
		).toBeVisible()
		const userId = await signedInUserId(page)
		try {
			const user = await prisma.user.findUniqueOrThrow({
				where: { id: userId! },
				select: { demoExpiresAt: true },
			})
			expect(user.demoExpiresAt).not.toBeNull()
		} finally {
			await page.close()
			if (userId) await deleteAccount(userId)
		}
	})

	test.fixme('Try the demo on the login page opens the app with the sample Recipes', async ({
		page,
	}) => {
		await page.goto('/login')
		await hydrated(page.getByRole('button', { name: 'Try the demo' }))
		await page.getByRole('button', { name: 'Try the demo' }).click()

		await expect(page).toHaveURL(/\/recipes/)
		await expect(banner(page)).toBeVisible()
		await expect(
			page
				.getByRole('main')
				.getByText(SAMPLE_HOUSEHOLD.recipes[0]!.title, { exact: true }),
		).toBeVisible()
		const userId = await signedInUserId(page)
		try {
			expect(
				await prisma.user.count({
					where: { id: userId!, demoExpiresAt: { not: null } },
				}),
			).toBe(1)
		} finally {
			await page.close()
			if (userId) await deleteAccount(userId)
		}
	})

	for (const { from, redirectTo } of [
		{ from: '/', redirectTo: '/' },
		{
			from: '/login?redirectTo=%2Fplan',
			redirectTo: '/login?redirectTo=%2Fplan',
		},
	]) {
		test(`Try the demo on ${from} posts to /demo and stays busy until it answers`, async ({
			page,
		}) => {
			// Hold the request, as a slow copy on production would.
			let release = () => {}
			const held = new Promise<void>((resolve) => (release = resolve))
			const posts: Array<Request> = []
			await page.route(/\/demo(\.data)?(\?.*)?$/, async (route) => {
				posts.push(route.request())
				await held
				await route.abort()
			})
			await page.goto(from)
			const button = page.getByRole('button', { name: 'Try the demo' })
			await hydrated(button)
			await button.click()

			await expect(button).toBeDisabled()
			await expect(button).toHaveAttribute('aria-busy', 'true')
			await button.click({ force: true }).catch(() => {})
			expect(posts).toHaveLength(1)
			expect(posts[0]!.method()).toBe('POST')
			expect(postedFields(posts[0]!)).toEqual({ redirectTo })
			release()
		})
	}
})

// Only the browser's clock can be moved here. Each test moves the demo's end
// on the server by as much, so a root reload the page makes after the jump
// (live refresh, a revalidation) reads the same time left.
async function moveEnd(userId: string, by: number) {
	const { demoExpiresAt } = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: { demoExpiresAt: true },
	})
	await prisma.user.update({
		where: { id: userId },
		data: { demoExpiresAt: new Date(demoExpiresAt!.getTime() + by) },
	})
}

test('the banner shows the server’s time left on a wrong browser clock, and counts down', async ({
	page,
	signInDemoUser,
}) => {
	const hydrationErrors: Array<string> = []
	page.on('console', (message) => {
		if (message.type() === 'error' && /hydrat/i.test(message.text())) {
			hydrationErrors.push(message.text())
		}
	})
	// Three hours ahead of the server.
	await page.clock.install({ time: new Date(Date.now() + 3 * HOUR) })
	const user = await signInDemoUser()
	await page.goto('/recipes')

	await expect(banner(page)).toContainText('This demo ends in 2 hr')
	await hydrated(banner(page))
	await moveEnd(user.id, -40 * MINUTE)
	await page.clock.fastForward(40 * MINUTE)
	await expect(banner(page)).toContainText('This demo ends in 1 hr 20 min')
	expect(hydrationErrors).toEqual([])

	// The banner is on every app page, pushed pages included.
	await page.goto('/settings/profile')
	await expect(banner(page)).toBeVisible()
})

test('time running out with the page open ends the banner and asks the server once', async ({
	page,
	signInDemoUser,
}) => {
	await page.clock.install()
	const user = await signInDemoUser()
	// Two minutes left.
	await prisma.user.update({
		where: { id: user.id },
		data: { demoExpiresAt: new Date(Date.now() + 2 * MINUTE) },
	})
	await page.goto('/recipes')
	await expect(banner(page)).toContainText('This demo ends in 2 min')
	await hydrated(banner(page))

	const rootLoads: Array<string> = []
	page.on('request', (request) => {
		const url = new URL(request.url())
		if (!url.pathname.endsWith('.data')) return
		// No `_routes` means every route on the page, root included.
		const routes = url.searchParams.get('_routes')
		if (!routes || routes.split(',').includes('root')) rootLoads.push(url.href)
	})
	await moveEnd(user.id, -3 * MINUTE)
	await page.clock.fastForward(3 * MINUTE)
	await expect(banner(page)).toContainText('This demo has ended')
	await expect(
		banner(page).getByRole('button', { name: 'Sign up' }),
	).toBeVisible()
	// The server here still honours the session, so the page stays. It asks
	// once; a page that asked on every tick would keep asking.
	await expect.poll(() => rootLoads.length).toBeGreaterThanOrEqual(1)
	const asked = rootLoads.length
	await page.clock.runFor(2 * MINUTE)
	await expect(banner(page)).toContainText('This demo has ended')
	expect(rootLoads).toHaveLength(asked)
})

test('a demo past its time still reads as a demo, with Sign up', async ({
	page,
	signInDemoUser,
}) => {
	const user = await signInDemoUser()
	await prisma.user.update({
		where: { id: user.id },
		data: { demoExpiresAt: new Date(Date.now() - 5 * MINUTE) },
	})
	await page.goto('/settings/profile')
	await expect(banner(page)).toContainText('This demo has ended')
	await expect(
		page.getByText(
			'Account, Household and import settings are off in the demo.',
		),
	).toBeVisible()
	await page.goto('/upgrade')
	await expect(page.getByRole('button', { name: 'Subscribe' })).toHaveCount(0)
	await expect(page.getByText(/Pro is here to show/)).toBeVisible()
})

test('Sign up in the banner ends the demo on its way to signup', async ({
	page,
	signInDemoUser,
}) => {
	await signInDemoUser()
	await page.goto('/recipes')
	await hydrated(banner(page))
	const form = banner(page).locator('form')
	await expect(form).toHaveAttribute('action', '/demo')
	await expect(form).toHaveAttribute('method', /post/i)
	await expect(form.locator('input[name="intent"]')).toHaveValue('end')
	await expect(form.locator('input[name="redirectTo"]')).toHaveValue('/signup')
})

// Switch on once POST /demo is on master (#440, slice 2).
test.fixme('Sign up in the banner deletes the demo user and opens signup', async ({
	page,
	signInDemoUser,
}) => {
	const user = await signInDemoUser()
	await page.goto('/recipes')
	await hydrated(banner(page))
	await banner(page).getByRole('button', { name: 'Sign up' }).click()

	await expect(page).toHaveURL(/\/signup$/)
	await expect(banner(page)).toHaveCount(0)
	await expect.poll(() => prisma.user.count({ where: { id: user.id } })).toBe(0)
})

test('Settings leaves out what the demo blocks and keeps export and theme', async ({
	page,
	signInDemoUser,
}) => {
	await signInDemoUser()
	await page.goto('/settings/profile')
	const main = page.getByRole('main')
	await expect(
		main.getByText(
			'Account, Household and import settings are off in the demo.',
		),
	).toBeVisible()
	for (const name of [
		/^Email/,
		/^Password/,
		/^Two-Factor Auth/,
		/^Passkeys/,
		/^Household/,
		/^Import Data/,
		/^Guest/,
	]) {
		await expect(main.getByRole('link', { name })).toHaveCount(0)
	}
	await expect(main.getByText(/@demo\.invalid/)).toHaveCount(0)
	await expect(
		main.getByRole('button', { name: 'Delete my account' }),
	).toHaveCount(0)
	await expect(
		main.getByRole('link', { name: 'Export All Data' }),
	).toBeVisible()
	await expect(main.getByRole('link', { name: 'Export Recipes' })).toBeVisible()
	await expect(main.getByText('Theme')).toBeVisible()
	await expect(main.getByRole('link', { name: /^Subscription/ })).toBeVisible()
	await expect(main.getByRole('button', { name: 'Log out' })).toBeVisible()
})

test('Upgrade explains Pro to a demo user and has no checkout', async ({
	page,
	signInDemoUser,
}) => {
	await signInDemoUser()
	await page.goto('/upgrade')
	const main = page.getByRole('main')
	await expect(main.getByText(/Pro is here to show/)).toBeVisible()
	await expect(main.getByText('You’re on the Pro plan')).toHaveCount(0)
	await expect(main.getByText("You're on the Pro plan")).toHaveCount(0)
	await expect(main.getByRole('button', { name: 'Subscribe' })).toHaveCount(0)
	await expect(
		main.locator('input[name="intent"][value="checkout"]'),
	).toHaveCount(0)
	const signUp = main.locator('form', {
		has: page.getByRole('button', { name: 'Sign up' }),
	})
	await expect(signUp).toHaveAttribute('action', '/demo')
	await expect(signUp.locator('input[name="intent"]')).toHaveValue('end')
	await expect(signUp.locator('input[name="redirectTo"]')).toHaveValue(
		'/signup',
	)
})

test('a real user sees no banner and no demo notes', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes')
	await hydrated(page.getByRole('main'))
	await expect(banner(page)).toHaveCount(0)
	await page.goto('/settings/profile')
	await expect(
		page.getByRole('main').getByRole('link', { name: /^Email/ }),
	).toBeVisible()
	await expect(page.getByText(/off in the demo/)).toHaveCount(0)
	await expect(banner(page)).toHaveCount(0)
	await page.goto('/upgrade')
	await expect(page.getByText(/Pro is here to show/)).toHaveCount(0)
})
