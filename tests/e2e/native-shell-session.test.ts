import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import * as setCookieParser from 'set-cookie-parser'
import { prisma } from '#app/utils/db.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import {
	createUser,
	expect,
	test,
	type AppPages,
} from '#tests/playwright-utils.ts'

// The iOS app loads the Web app in a WKWebView and appends this token to the
// user agent. WKWebView drops a session cookie without an expiry when iOS
// kills the app, so the iOS app never offers "Remember me" and always gets
// an expiring session cookie.
// `onboardingEmailSessionKey` in app/routes/_auth/onboarding/index.tsx. The
// route module imports the icon sprite, which Playwright cannot load.
const onboardingEmailSessionKey = 'onboardingEmail'

const SAFARI_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const SHELL_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QuartermasterShell/1'

async function sessionCookieExpiry(page: Page): Promise<number> {
	const cookies = await page.context().cookies()
	const session = cookies.find((cookie) => cookie.name === 'en_session')
	if (!session) throw new Error('No en_session cookie')
	return session.expires
}

async function logInThroughTheForm(
	page: Page,
	navigate: (path: AppPages) => Promise<unknown>,
	user: { username: string },
	password: string,
) {
	await navigate('/login')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByRole('button', { name: /log in/i }).click()
	await expect(page).toHaveURL('/recipes')
}

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('login hides Remember me and keeps the session past an app kill', async ({
		page,
		navigate,
		login,
	}) => {
		const password = faker.internet.password()
		const user = await login({ password })
		// `login` signs in by cookie; this test signs in through the form, so
		// drop that session and leave only the one the form creates.
		await page.context().clearCookies()
		await prisma.session.deleteMany({ where: { userId: user.id } })

		await navigate('/login')
		await expect(page.getByRole('button', { name: /log in/i })).toBeVisible()
		await expect(page.getByLabel(/remember me/i)).toHaveCount(0)

		await logInThroughTheForm(page, navigate, user, password)

		const expires = await sessionCookieExpiry(page)
		expect(expires, 'session cookie must outlive the app').not.toBe(-1)
		const session = await prisma.session.findFirstOrThrow({
			where: { userId: user.id },
			select: { expirationDate: true },
		})
		// Chrome rebases Expires on the response's Date header, so the stored
		// expiry lands within a few seconds of the session's, not on it.
		expect(
			Math.abs(expires - session.expirationDate.getTime() / 1000),
		).toBeLessThan(10)
	})

	test('onboarding hides Remember me and keeps the new session past an app kill', async ({
		page,
		navigate,
	}) => {
		const { username, name, email } = createUser()
		const password = faker.internet.password()
		// Email verification puts the address in the verify session; start
		// from there rather than repeat the signup flow onboarding.test covers.
		const verifySession = await verifySessionStorage.getSession()
		verifySession.set(onboardingEmailSessionKey, email)
		const cookie = setCookieParser.parseString(
			await verifySessionStorage.commitSession(verifySession),
		)
		if (!cookie) throw new Error('Failed to parse the verify session cookie')
		await page.context().addCookies([
			{
				name: cookie.name,
				value: cookie.value,
				domain: 'localhost',
				path: '/',
				httpOnly: true,
				secure: cookie.secure,
				sameSite: 'Lax',
			},
		])

		try {
			await navigate('/onboarding')
			await expect(
				page.getByRole('button', { name: /create an account/i }),
			).toBeVisible()
			await expect(page.getByLabel(/remember me/i)).toHaveCount(0)

			await page.getByRole('textbox', { name: /^username/i }).fill(username)
			await page.getByRole('textbox', { name: /^name/i }).fill(name)
			await page.getByLabel(/^password/i).fill(password)
			await page.getByLabel(/^confirm password/i).fill(password)
			await page.getByLabel(/terms/i).check()
			await page.getByRole('button', { name: /create an account/i }).click()
			await expect(page).toHaveURL('/recipes')

			expect(
				await sessionCookieExpiry(page),
				'session cookie must outlive the app',
			).not.toBe(-1)
		} finally {
			await page.close()
			const households = await prisma.household.findMany({
				where: { members: { some: { user: { username } } } },
				select: { id: true },
			})
			await prisma.user.deleteMany({ where: { username } })
			await prisma.household.deleteMany({
				where: { id: { in: households.map((household) => household.id) } },
			})
		}
	})
})

test.describe('in a browser', () => {
	test.use({ userAgent: SAFARI_UA })

	test('login offers Remember me, and unchecked it keeps a browser-session cookie', async ({
		page,
		navigate,
		login,
	}) => {
		const password = faker.internet.password()
		const user = await login({ password })
		await page.context().clearCookies()

		await navigate('/login')
		await expect(page.getByLabel(/remember me/i)).toBeVisible()
		await expect(page.getByLabel(/remember me/i)).not.toBeChecked()

		await logInThroughTheForm(page, navigate, user, password)

		expect(await sessionCookieExpiry(page)).toBe(-1)
	})
})
