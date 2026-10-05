import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import * as setCookieParser from 'set-cookie-parser'
import { createOwnHousehold, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { expect, test as base } from '#tests/playwright-utils.ts'

const DAY = 1000 * 60 * 60 * 24

const test = base.extend<{
	insertRegisteredUser(options: {
		password: string
	}): Promise<{ id: string; username: string }>
}>({
	// A registered user signed up, so they already have a Household.
	insertRegisteredUser: async ({ page, insertNewUser }, use) => {
		let householdId: string | undefined
		await use(async (options) => {
			const user = await insertNewUser(options)
			householdId = (await createOwnHousehold(prisma, user)).id
			return user
		})
		await page.close()
		if (householdId) {
			await prisma.household.delete({ where: { id: householdId } })
		}
	},
})

async function getSessionCookie(page: Page) {
	const cookies = await page.context().cookies()
	const cookie = cookies.find((c) => c.name === 'en_session')
	if (!cookie) throw new Error('No en_session cookie')
	return cookie
}

/**
 * Makes the Session look like it was created long ago: the row and the
 * cookie's Expires both end `expiresIn` from now, as they would after
 * 30 - expiresIn days of use.
 */
async function ageSession(page: Page, sessionId: string, expiresIn: number) {
	const expirationDate = new Date(Date.now() + expiresIn)
	await prisma.session.update({
		where: { id: sessionId },
		data: { expirationDate },
	})
	const current = await getSessionCookie(page)
	const authSession = await authSessionStorage.getSession(
		`${current.name}=${current.value}`,
	)
	const parsed = setCookieParser.parseString(
		await authSessionStorage.commitSession(authSession, {
			expires: expirationDate,
		}),
	)
	if (!parsed) throw new Error('Failed to parse session cookie')
	await page.context().addCookies([
		{
			name: parsed.name,
			value: parsed.value,
			url: page.url(),
			httpOnly: true,
			sameSite: 'Lax',
			expires: Math.floor(expirationDate.getTime() / 1000),
		},
	])
	return expirationDate
}

test('a remembered session in daily use is extended near its end', async ({
	page,
	navigate,
	insertRegisteredUser,
}) => {
	const password = faker.internet.password()
	const user = await insertRegisteredUser({ password })

	await navigate('/login')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByLabel(/remember me/i).check()
	await page.getByRole('button', { name: /log in/i }).click()
	await expect(page).toHaveURL('/recipes')

	const { id: sessionId } = await prisma.session.findFirstOrThrow({
		where: { userId: user.id },
		select: { id: true },
	})
	const loginCookie = await getSessionCookie(page)
	const loginSession = await authSessionStorage.getSession(
		`${loginCookie.name}=${loginCookie.value}`,
	)
	expect(loginSession.get(sessionKey)).toBe(sessionId)

	// 20 days left: a page load leaves the row and the cookie alone.
	const twentyDaysOut = await ageSession(page, sessionId, 20 * DAY)
	await page.reload()
	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
	const untouched = await prisma.session.findUniqueOrThrow({
		where: { id: sessionId },
		select: { expirationDate: true },
	})
	expect(untouched.expirationDate).toEqual(twentyDaysOut)
	expect((await getSessionCookie(page)).expires).toBe(
		Math.floor(twentyDaysOut.getTime() / 1000),
	)

	// 2 days left: a page load pushes both out a full 30 days.
	await ageSession(page, sessionId, 2 * DAY)
	await page.reload()
	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
	const refreshed = await prisma.session.findUniqueOrThrow({
		where: { id: sessionId },
		select: { expirationDate: true },
	})
	const thirtyDaysOut = Date.now() + 30 * DAY
	expect(
		Math.abs(refreshed.expirationDate.getTime() - thirtyDaysOut),
	).toBeLessThan(60_000)
	const cookie = await getSessionCookie(page)
	expect(Math.abs(cookie.expires * 1000 - thirtyDaysOut)).toBeLessThan(60_000)
	// Chromium shifts a server-set Expires by the clock skew it sees in the
	// response's Date header, so compare to the row within a few seconds.
	expect(
		Math.abs(cookie.expires * 1000 - refreshed.expirationDate.getTime()),
	).toBeLessThan(5_000)
})
