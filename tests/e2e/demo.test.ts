import { type Page } from '@playwright/test'
import { sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { deleteDemoUser, expireDemoUsers } from '#app/utils/demo.server.ts'
import { SAMPLE_HOUSEHOLD } from '#app/utils/sample-household-data.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

/**
 * The demo: a visitor gets a user of their own with a copy of the sample
 * Household, which ends after a couple of hours. The e2e database has a demo
 * template (scripts/e2e.sh builds one).
 */

/**
 * The timezone hint the page would set on its first visit, so the copy's
 * sample week is the browser's week, as in a real visit.
 */
async function setTimeZoneHint(page: Page) {
	await page.context().addCookies([
		{
			name: 'CH-time-zone',
			value: encodeURIComponent(
				Intl.DateTimeFormat().resolvedOptions().timeZone,
			),
			domain: 'localhost',
			path: '/',
		},
	])
}

/** The user this browser's session cookie is signed in as, if any. */
async function signedInUserId(page: Page) {
	const cookie = (await page.context().cookies()).find(
		(c) => c.name === 'en_session',
	)
	if (!cookie) return null
	const authSession = await authSessionStorage.getSession(
		`en_session=${cookie.value}`,
	)
	const session = await prisma.session.findUnique({
		where: { id: String(authSession.get(sessionKey)) },
		select: { userId: true },
	})
	return session?.userId ?? null
}

/**
 * Start a demo in this page's browser, as "Try the demo" does, and return
 * the demo user. The test deletes it however it ends.
 */
async function startDemo(page: Page, demoUserIds: string[]) {
	await setTimeZoneHint(page)
	const response = await page.request.post('/demo', { maxRedirects: 0 })
	expect(response.status()).toBe(302)
	expect(response.headers().location).toBe('/recipes')
	const userId = await signedInUserId(page)
	expect(userId).not.toBeNull()
	demoUserIds.push(userId!)
	return prisma.user.findUniqueOrThrow({
		where: { id: userId! },
		select: {
			id: true,
			demoExpiresAt: true,
			householdMembers: { select: { householdId: true } },
		},
	})
}

const demoUserIds: string[] = []

test.afterEach(async () => {
	for (const userId of demoUserIds.splice(0)) {
		await deleteDemoUser(userId).catch(() => {})
	}
})

test('a demo opens on the sample Recipes and this week’s Plan, and ends signed out when its time is up', async ({
	page,
}) => {
	const visitor = await startDemo(page, demoUserIds)
	const householdId = visitor.householdMembers[0]!.householdId
	expect(visitor.demoExpiresAt).not.toBeNull()
	// The session ends when the demo does.
	const session = await prisma.session.findFirstOrThrow({
		where: { userId: visitor.id },
		select: { expirationDate: true },
	})
	expect(session.expirationDate).toEqual(visitor.demoExpiresAt)

	await page.goto('/recipes')
	const main = page.getByRole('main')
	for (const recipe of SAMPLE_HOUSEHOLD.recipes) {
		await expect(main.getByText(recipe.title, { exact: true })).toBeVisible()
	}

	await page.goto('/plan')
	for (const title of ['Lemon chicken traybake', 'Black bean tacos']) {
		await expect(main.getByRole('heading', { name: title })).toBeVisible()
	}

	// Leave the app first, so no request from the open Plan (its live-update
	// poll) reaches the server after the time moves.
	await page.goto('about:blank')
	// The demo's time runs out. Its session was made to end at the same
	// moment, so both move back.
	const past = new Date(Date.now() - 1000)
	await prisma.user.update({
		where: { id: visitor.id },
		data: { demoExpiresAt: past },
	})
	await prisma.session.updateMany({
		where: { userId: visitor.id },
		data: { expirationDate: past },
	})

	// The server finds the session over and sends the browser home with its
	// cookie cleared.
	await page.goto('/plan')
	await expect(page).toHaveURL('/')
	await expect(
		page.getByRole('link', { name: 'Log in', exact: true }).first(),
	).toBeVisible()
	expect(await signedInUserId(page)).toBeNull()

	await expireDemoUsers({
		onFailure: (userId, error) => {
			throw new Error(`Couldn't expire ${userId}: ${String(error)}`)
		},
	})
	expect(await prisma.user.count({ where: { id: visitor.id } })).toBe(0)
	expect(await prisma.household.count({ where: { id: householdId } })).toBe(0)
})
