import {
	test as base,
	type Locator,
	type Page,
	type Response,
} from '@playwright/test'
import { href, type Register } from 'react-router'
import * as setCookieParser from 'set-cookie-parser'
import { type User as UserModel } from '#app/generated/prisma/client.ts'
import {
	createOwnHousehold,
	getPasswordHash,
	getSessionExpirationDate,
	sessionKey,
} from '#app/utils/auth.server.ts'
import { parseDate, todayInTimeZone } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from './db-utils.ts'

export * from './db-utils.ts'

/**
 * Today as the app sees it in these tests, as a UTC-midnight Date. The app's
 * today follows the browser's timezone, and Playwright's browser runs in the
 * machine's zone unless a test sets `timezoneId`.
 */
export function browserToday() {
	return parseDate(
		todayInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
	)
}

type GetOrInsertUserOptions = {
	id?: string
	username?: UserModel['username']
	password?: string
	email?: UserModel['email']
}

type User = {
	id: string
	email: string
	username: string
	name: string | null
}

type LoggedInUser = User & { householdId: string }

async function getOrInsertUser({
	id,
	username,
	password,
	email,
}: GetOrInsertUserOptions = {}): Promise<User> {
	const select = { id: true, email: true, username: true, name: true }
	if (id) {
		return await prisma.user.findUniqueOrThrow({
			select,
			where: { id: id },
		})
	} else {
		const userData = createUser()
		username ??= userData.username
		password ??= userData.username
		email ??= userData.email
		return await prisma.user.create({
			select,
			data: {
				...userData,
				email,
				username,
				roles: { connect: { name: 'user' } },
				password: { create: { hash: await getPasswordHash(password) } },
			},
		})
	}
}

export type AppPages = keyof Register['pages']

// `PW_CPU_THROTTLE=4` slows the page's CPU four times, to bring out the races
// a slow CI runner hits: an effect landing after the test has moved on.
const cpuThrottle = Number(process.env.PW_CPU_THROTTLE) || 0

export const test = base.extend<{
	navigate: <Path extends AppPages>(
		...args: Parameters<typeof href<Path>>
	) => Promise<null | Response>
	insertNewUser(options?: GetOrInsertUserOptions): Promise<User>
	login(options?: GetOrInsertUserOptions): Promise<LoggedInUser>
}>({
	page: async ({ page }, use) => {
		if (cpuThrottle > 1) {
			// The session stays open for the whole test: closing it ends the
			// throttling.
			const cdp = await page.context().newCDPSession(page)
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
		}
		await use(page)
	},
	navigate: async ({ page }, use) => {
		await use((...args) => {
			return page.goto(href(...args))
		})
	},
	// Inserts a user with no Household and no session. Production can't make
	// that user, since signup always creates a Household, so give them one
	// with `createOwnHousehold` before they sign in through the UI.
	// oxlint-disable-next-line no-empty-pattern -- Playwright reads fixtures from an object pattern, even an empty one
	insertNewUser: async ({}, use) => {
		let userId: string | undefined = undefined
		await use(async (options) => {
			const user = await getOrInsertUser(options)
			userId = user.id
			return user
		})
		// A failed `getOrInsertUser` leaves `userId` undefined. Prisma drops an
		// undefined filter, so an unguarded delete would reach every user in the
		// database rather than none.
		if (userId) {
			await prisma.user.delete({ where: { id: userId } }).catch(() => {})
		}
	},
	// Signs a user in and returns them with the id of their Household. A new
	// user gets a Household the way signup gives one. `{ id }` signs in an
	// existing user in the Household they already belong to, and creates one
	// only if they have none. Seed data into `householdId`; a test that creates
	// another Household for this user gives them two memberships.
	login: async ({ page, colorScheme, timezoneId }, use) => {
		const createdUserIds: Array<string> = []
		const createdHouseholdIds: Array<string> = []
		await use(async (options) => {
			const user = await getOrInsertUser(options)
			if (!options?.id) createdUserIds.push(user.id)
			const membership = options?.id
				? await prisma.householdMember.findFirst({
						where: { userId: user.id },
						select: { householdId: true },
					})
				: null
			let householdId = membership?.householdId
			if (!householdId) {
				householdId = (await createOwnHousehold(prisma, user)).id
				createdHouseholdIds.push(householdId)
			}
			const session = await prisma.session.create({
				data: {
					expirationDate: getSessionExpirationDate(),
					userId: user.id,
				},
				select: { id: true },
			})

			const authSession = await authSessionStorage.getSession()
			authSession.set(sessionKey, session.id)
			const cookieConfig = setCookieParser.parseString(
				await authSessionStorage.commitSession(authSession),
			)
			if (!cookieConfig) throw new Error('Failed to parse session cookie')
			const newConfig = {
				...cookieConfig,
				name: cookieConfig.name,
				value: cookieConfig.value,
				domain: 'localhost',
				expires: cookieConfig.expires?.getTime(),
				sameSite: cookieConfig.sameSite as 'Strict' | 'Lax' | 'None',
			}
			// The hint cookies the page's own check would write on a first
			// visit, so a signed-in test starts on a real page rather than on the
			// check's reload, whose cookies Chromium can drop (first-visit-hints
			// covers that reload).
			const hint = (name: string, value: string) => ({
				name,
				value: encodeURIComponent(value),
				domain: 'localhost',
				path: '/',
			})
			await page
				.context()
				.addCookies([
					newConfig,
					hint(
						'CH-time-zone',
						timezoneId ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
					),
					hint(
						'CH-prefers-color-scheme',
						colorScheme === 'dark' ? 'dark' : 'light',
					),
				])
			return { ...user, householdId }
		})
		// Close the page first, so live refresh and revalidation send no new
		// requests for the rows the deletes below remove. A request the server
		// already has still runs, and can log a foreign key error.
		await page.close()
		await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
		await prisma.household.deleteMany({
			where: { id: { in: createdHouseholdIds } },
		})
	},
})
export const { expect } = test

/**
 * This allows you to wait for something (like an email to be available).
 *
 * It calls the callback every 50ms until it returns a value (and does not throw
 * an error). After the timeout, it will throw the last error that was thrown or
 * throw the error message provided as a fallback
 */
export async function waitFor<ReturnValue>(
	cb: () => ReturnValue | Promise<ReturnValue>,
	{
		errorMessage,
		timeout = 5000,
	}: { errorMessage?: string; timeout?: number } = {},
) {
	const endTime = Date.now() + timeout
	let lastError: unknown = new Error(errorMessage)
	while (Date.now() < endTime) {
		try {
			const response = await cb()
			if (response) return response
		} catch (e: unknown) {
			lastError = e
		}
		await new Promise((r) => setTimeout(r, 100))
	}
	throw lastError
}

/**
 * Waits until the page has hydrated. The root layout sets the marker once, on
 * the first load, after every mount effect has run, so the router takes
 * navigations by then. State those effects set can still commit after it, so
 * it doesn't mean the page has settled. After a client navigation the marker
 * is already there.
 */
export async function waitForHydration(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-hydrated')
}

/**
 * Waits for `target` to be on the page and for the page to have hydrated.
 * After a client navigation the marker is already set (see
 * `waitForHydration`), so this only checks that `target` is attached.
 */
export async function hydrated(target: Locator) {
	await expect(target).toBeAttached()
	await waitForHydration(target.page())
}

/** Opens Shopping and waits until it has hydrated: it fills its client id then. */
export async function openShopping(page: Page) {
	await page.goto('/shopping')
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll<HTMLInputElement>(
				'input[name="originClientId"]',
			),
		].some((input) => input.value),
	)
}

/** Checks that a control is visible and at least 44px tall, a thumb's height. */
export async function expectThumbTall(control: Locator) {
	await expect(control).toBeVisible()
	const box = await control.boundingBox()
	expect(box, 'control has a box').not.toBeNull()
	expect(box!.height).toBeGreaterThanOrEqual(44)
}

/** Checks that a control is visible and at least 44px each way. */
export async function expectThumbSized(control: Locator) {
	await expectThumbTall(control)
	expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(44)
}

/** Taps until the tap lands on a hydrated page and `then` holds. */
export async function tapUntil(
	control: Locator,
	then: () => Promise<void>,
	timeout = 10_000,
) {
	await expect(async () => {
		await control.tap()
		await then()
	}).toPass({ timeout })
}

/**
 * Waits two frames, so a transition that a change has just started is
 * running, then until every animation on the page that ends has finished.
 */
export async function animationsFinished(page: Page) {
	await page.evaluate(async () => {
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		)
		await Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().endTime !== Infinity,
				)
				.map((animation) => animation.finished.catch(() => {})),
		)
	})
}
