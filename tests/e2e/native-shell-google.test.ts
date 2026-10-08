import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// Google refuses OAuth in embedded web views, so the iOS app offers no Google
// login, signup, or connection, and tells Google users how to get in.
const googleHint =
	'Signed up with Google? Add a passkey or password in Settings on the web first.'

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('login offers no Google and explains how Google users get in', async ({
		page,
		navigate,
	}) => {
		await navigate('/login')
		await expect(page.getByRole('button', { name: /^log in$/i })).toBeVisible()
		await expect(page.getByText(googleHint, { exact: true })).toBeVisible()
		await expect(
			page.getByRole('button', { name: /log in with google/i }),
		).toHaveCount(0)
		await expect(page.getByText(/^or$/)).toHaveCount(0)
	})

	test('signup offers no Google', async ({ page, navigate }) => {
		await navigate('/signup')
		await expect(page.getByRole('button', { name: /submit/i })).toBeVisible()
		await expect(
			page.getByRole('button', { name: /sign up with google/i }),
		).toHaveCount(0)
		await expect(page.getByText(/^or$/)).toHaveCount(0)
		await expect(page.getByText(googleHint)).toHaveCount(0)
	})

	test('connections offers no Google connection', async ({
		page,
		navigate,
		login,
	}) => {
		await login()
		await navigate('/settings/profile/connections')
		await expect(
			page.getByText(/you don't have any connections yet/i),
		).toBeVisible()
		await expect(
			page.getByRole('button', { name: /connect with google/i }),
		).toHaveCount(0)
	})
})

test.describe('in a browser', () => {
	test.use({ userAgent: SAFARI_UA })

	test('login offers Google and no hint', async ({ page, navigate }) => {
		await navigate('/login')
		await expect(
			page.getByRole('button', { name: /log in with google/i }),
		).toBeVisible()
		await expect(page.getByText(googleHint)).toHaveCount(0)
	})

	test('signup offers Google', async ({ page, navigate }) => {
		await navigate('/signup')
		await expect(
			page.getByRole('button', { name: /sign up with google/i }),
		).toBeVisible()
		await expect(page.getByText(googleHint)).toHaveCount(0)
	})

	test('connections offers a Google connection', async ({
		page,
		navigate,
		login,
	}) => {
		await login()
		await navigate('/settings/profile/connections')
		await expect(
			page.getByRole('button', { name: /connect with google/i }),
		).toBeVisible()
	})
})
