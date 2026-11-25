// What a demo visitor sees: the "Try the demo" buttons, the banner on every
// app page, and the Settings and Upgrade pages without what the demo can't do.
//
// Failure list:
// - "Try the demo" posts to /demo without an intent, with the page it is on as
//   `redirectTo`, so a "demo is full" toast lands back there
// - the login page carries a `redirectTo` (an invite, a deep link): a demo
//   can't join a Household, so the button isn't offered there
// - a second tap while the copy is being made posts again: the button is busy
//   and disabled until the answer comes
// - the banner's first paint is wrong when the browser's clock is off: it
//   must show the server's time left, with no hydration error (production
//   React reports one as a minified page error, not a console message)
// - the banner stops at its first reading: it must count down without a
//   reload
// - time runs out with the page open: the banner says the demo has ended and
//   still offers Sign up; the page asks the server once, not on every tick
// - time runs out and the server has ended the session with it: the visitor
//   is signed out, not left on a page that still says they're in a demo
// - Sign up in the banner has no visible focus for a keyboard
// - Sign up goes straight to /signup, which bounces a signed-in user: it must
//   end the demo first (`intent=end`)
// - Settings offers the account, Household and backup restore rows the demo
//   blocks, or shows the demo's .invalid email
// - Upgrade says nothing to a demo user about why there's no checkout
// - the shared Recipe page pins its ingredients under a fixed header height,
//   so the taller header with the banner covers their top on a desktop
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
	createUser,
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
	test('Try the demo on the homepage opens the app with the sample Recipes', async ({
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

	test('Try the demo on the login page opens the app with the sample Recipes', async ({
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
		{ from: '/login', redirectTo: '/login' },
	]) {
		test(`Try the demo on ${from} posts to /demo and stays busy until it answers`, async ({
			page,
		}) => {
			// Hold the request, as a slow copy on production would.
			let release = () => {}
			const held = new Promise<void>((resolve) => (release = resolve))
			const posts: Array<Request> = []
			await page.route(/\/demo(\.data)?(\?.*)?$/, async (route) => {
				// After the failed post the router loads /demo too, with a GET.
				if (route.request().method() === 'POST') posts.push(route.request())
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
			release()
			// Counted once the submission has finished, so a late second post
			// would be in.
			await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
			expect(posts).toHaveLength(1)
			expect(posts[0]!.method()).toBe('POST')
			expect(postedFields(posts[0]!)).toEqual({ redirectTo })
		})
	}

	test('the login page with a redirectTo offers no demo', async ({ page }) => {
		await page.goto('/login?redirectTo=%2Fhousehold%2Fjoin%2Fsome-invite')
		await hydrated(page.getByRole('button', { name: 'Log in', exact: true }))
		await expect(
			page.getByRole('button', { name: 'Try the demo' }),
		).toHaveCount(0)
	})
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
	// The production build reports a hydration mismatch as a minified page
	// error ("Minified React error #418"); a development build logs it.
	const hydrationErrors: Array<string> = []
	page.on('pageerror', (error) => hydrationErrors.push(error.message))
	page.on('console', (message) => {
		if (
			message.type() === 'error' &&
			/hydrat|Minified React error/i.test(message.text())
		) {
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
			'Account, Household and backup restore are off in the demo.',
		),
	).toBeVisible()
	await page.goto('/upgrade')
	await expect(
		page.getByText(/reference implementation, with Stripe/),
	).toBeVisible()
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

test('Sign up in the banner deletes the demo user and opens signup', async ({
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
			'Account, Household and backup restore are off in the demo.',
		),
	).toBeVisible()
	for (const name of [
		/^Email/,
		/^Password/,
		/^Two-factor auth/,
		/^Passkeys/,
		/^Household/,
		/^Import data/,
		/^Guest/,
	]) {
		await expect(main.getByRole('link', { name })).toHaveCount(0)
	}
	await expect(main.getByText(/@demo\.invalid/)).toHaveCount(0)
	await expect(
		main.getByRole('button', { name: 'Delete my account' }),
	).toHaveCount(0)
	await expect(
		main.getByRole('link', { name: 'Export all data' }),
	).toBeVisible()
	await expect(main.getByRole('link', { name: 'Export Recipes' })).toBeVisible()
	await expect(main.getByText('Theme')).toBeVisible()
	await expect(main.getByRole('link', { name: /^Subscription/ })).toBeVisible()
	await expect(main.getByRole('button', { name: 'Log out' })).toBeVisible()
})

test('Upgrade explains to a demo user why there is no checkout', async ({
	page,
	signInDemoUser,
}) => {
	await signInDemoUser()
	await page.goto('/upgrade')
	const main = page.getByRole('main')
	await expect(
		main.getByText(
			"The demo runs as Pro, so there's no checkout. Pro isn't on sale. It's a reference implementation, with Stripe Checkout and its webhooks built and tested.",
		),
	).toBeVisible()
	await expect(main.getByText("You're on Pro")).toHaveCount(0)
	await expect(
		main.getByRole('button', { name: 'Current', exact: true }),
	).toHaveCount(1)
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
	await expect(
		page.getByText(/reference implementation, with Stripe/),
	).toHaveCount(0)
})

// The demo's session ends at `demoExpiresAt` (app/routes/demo.tsx).
test('when time runs out and the session ends with it, the visitor is signed out', async ({
	page,
	signInDemoUser,
}) => {
	await page.clock.install()
	const user = await signInDemoUser()
	await page.goto('/recipes')
	await expect(banner(page)).toContainText('This demo ends in')
	await hydrated(banner(page))

	const ended = new Date(Date.now() - 1000)
	await prisma.user.update({
		where: { id: user.id },
		data: { demoExpiresAt: ended },
	})
	await prisma.session.updateMany({
		where: { userId: user.id },
		data: { expirationDate: ended },
	})
	await page.clock.fastForward(2 * HOUR + MINUTE)

	// The root loader sends an ended session home and a page's own loader
	// sends it to log in; either way the demo is gone from the page.
	await expect(banner(page)).toHaveCount(0)
	await expect(page).toHaveURL(/\/(login(\?.*)?)?$/)
	expect(await signedInUserId(page)).toBeNull()
	await page.goto('about:blank')
	await page.goto('/')
	await expect(page).toHaveURL(/\/$/)
	await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible()
})

test('Sign up in the banner shows a focus ring from the keyboard', async ({
	page,
	signInDemoUser,
}) => {
	await signInDemoUser()
	await page.goto('/recipes')
	await hydrated(banner(page))
	const signUp = banner(page).getByRole('button', { name: 'Sign up' })
	for (let tab = 0; tab < 5; tab++) {
		await page.keyboard.press('Tab')
		if (await signUp.evaluate((el) => el === document.activeElement)) break
	}
	await expect(signUp).toBeFocused()
	expect(
		await signUp.evaluate((el) => getComputedStyle(el).boxShadow),
	).not.toBe('none')
})

/** A Recipe in another Household, long enough that its page scrolls. */
async function sharedRecipe() {
	const owner = await prisma.user.create({ data: createUser() })
	const household = await prisma.household.create({
		data: {
			name: 'Sharing household',
			members: { create: { userId: owner.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Long braise',
			userId: owner.id,
			householdId: household.id,
			ingredients: {
				create: [{ name: 'beef shin', amount: '1', unit: 'kg', order: 0 }],
			},
			instructions: {
				create: Array.from({ length: 30 }, (_, order) => ({
					order,
					content: `Step ${order + 1}: stir, taste and keep it at a low simmer for a while longer, topping up with stock when it looks dry.`,
				})),
			},
		},
		select: { id: true },
	})
	return {
		id: recipe.id,
		async [Symbol.asyncDispose]() {
			await prisma.household.delete({ where: { id: household.id } })
			await prisma.user.delete({ where: { id: owner.id } })
		},
	}
}

/** Where the pinned ingredients column and the header sit after a scroll. */
async function pinnedIngredients(page: Page) {
	await page.mouse.wheel(0, 800)
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(400)
	return page.evaluate(() => {
		const header = document.querySelector('[data-site-header]')!
		const column = [...document.querySelectorAll('#main-content *')].find(
			(el) => getComputedStyle(el).position === 'sticky',
		)!
		return {
			headerBottom: Math.round(header.getBoundingClientRect().bottom),
			columnTop: Math.round(column.getBoundingClientRect().top),
		}
	})
}

test.describe('the shared Recipe page on a desktop', () => {
	test.use({ viewport: { width: 1280, height: 800 } })

	test('pins the ingredients below the header with the demo banner', async ({
		page,
		signInDemoUser,
	}) => {
		await using recipe = await sharedRecipe()
		await signInDemoUser()
		await page.goto(`/share/${recipe.id}`)
		await hydrated(banner(page))
		const { headerBottom, columnTop } = await pinnedIngredients(page)
		expect(columnTop).toBeGreaterThanOrEqual(headerBottom)
	})

	test('keeps a real user’s ingredients where they were', async ({
		page,
		login,
	}) => {
		await using recipe = await sharedRecipe()
		await login()
		await page.goto(`/share/${recipe.id}`)
		await hydrated(page.getByRole('main'))
		const { headerBottom, columnTop } = await pinnedIngredients(page)
		// lg:top-20, 5px below the 75px header.
		expect({ headerBottom, columnTop }).toEqual({
			headerBottom: 75,
			columnTop: 80,
		})
	})
})
