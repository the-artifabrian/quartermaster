import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { createOwnHousehold } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
} from '#app/utils/user-validation.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import {
	createUser,
	expect,
	test as base,
	type AppPages,
	waitFor,
} from '#tests/playwright-utils.ts'

const URL_REGEX = /(?<url>https?:\/\/[^\s$.?#].[^\s]*)/
const CODE_REGEX = /Here's your verification code: (?<code>[\d\w]+)/
function extractUrl(text: string) {
	const match = text.match(URL_REGEX)
	return match?.groups?.url
}

const test = base.extend<{
	getOnboardingData(): {
		username: string
		name: string
		email: string
		password: string
	}
	insertRegisteredUser(options: { password: string }): Promise<{
		id: string
		email: string
		username: string
		name: string | null
	}>
}>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright reads fixtures from an object pattern, even an empty one
	getOnboardingData: async ({}, use) => {
		const userData = createUser()
		await use(() => {
			const onboardingData = {
				...userData,
				password: faker.internet.password(),
			}
			return onboardingData
		})
		// Signup gave the user a Household, which deleting the user leaves behind.
		const households = await prisma.household.findMany({
			where: { members: { some: { user: { username: userData.username } } } },
			select: { id: true },
		})
		await prisma.user.deleteMany({ where: { username: userData.username } })
		await prisma.household.deleteMany({
			where: { id: { in: households.map((household) => household.id) } },
		})
	},
	// A registered user signed up, so they already have a Household.
	insertRegisteredUser: async ({ page, insertNewUser }, use) => {
		let householdId: string | undefined
		await use(async (options) => {
			const user = await insertNewUser(options)
			householdId = (await createOwnHousehold(prisma, user)).id
			return user
		})
		// Stop the page's new requests before the Household goes, as `login`
		// does. `insertNewUser` deletes the user afterwards.
		await page.close()
		if (householdId) {
			await prisma.household.delete({ where: { id: householdId } })
		}
	},
})

test('onboarding with link', async ({ page, navigate, getOnboardingData }) => {
	const onboardingData = getOnboardingData()

	await navigate('/')

	await page.getByRole('link', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/login`)

	const createAccountLink = page.getByRole('link', {
		name: /create an account/i,
	})
	await createAccountLink.click()

	await expect(page).toHaveURL(`/signup`)

	const emailTextbox = page.getByRole('textbox', { name: /email/i })
	await emailTextbox.click()
	await emailTextbox.fill(onboardingData.email)

	await page.getByRole('button', { name: /email me a code/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	await expect(page.getByText(/asked more than once\?/i)).toBeVisible()

	const email = await readEmail(onboardingData.email)
	invariant(email, 'Email not found')
	expect(email.to).toBe(onboardingData.email.toLowerCase())
	expect(email.from).toBe('hello@useqm.app')
	expect(email.subject).toMatch(/sign-up code/i)
	const onboardingUrl = extractUrl(email.text) as AppPages
	invariant(onboardingUrl, 'Onboarding URL not found')
	expect(new URL(onboardingUrl).searchParams.get('code')).toBeNull()
	await navigate(onboardingUrl)

	await expect(page).toHaveURL(/\/verify/)
	await expect(
		page.getByRole('heading', { name: /your link is ready/i }),
	).toBeVisible()
	await expect(page.getByText(/check your email/i)).toBeHidden()
	// Mail scanners fetch links, so opening one uses nothing up.
	await page.reload()
	await expect(page.getByText(/your link is ready/i)).toBeVisible()
	const emailCodes = {
		where: { target: onboardingData.email.toLowerCase() },
	}
	expect(await prisma.emailCode.count(emailCodes)).toBe(1)

	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL(`/onboarding`)
	expect(await prisma.emailCode.count(emailCodes)).toBe(0)
	await page
		.getByRole('textbox', { name: /^username/i })
		.fill(onboardingData.username)

	await page.getByRole('textbox', { name: /^name/i }).fill(onboardingData.name)

	await page.getByLabel(/^password/i).fill(onboardingData.password)

	await page.getByLabel(/^confirm password/i).fill(onboardingData.password)

	await page.waitForLoadState('networkidle') // ensure js is fully loaded.

	await page.getByLabel(/terms/i).check()

	await page.getByLabel(/remember me/i).check()

	await page.getByRole('button', { name: /Create an account/i }).click()

	await expect(page).toHaveURL(`/recipes`)

	await page.getByRole('link', { name: 'Settings' }).click()
	await expect(page).toHaveURL(`/settings/profile`)

	await page.getByRole('button', { name: /log out/i }).click()
	await expect(page).toHaveURL(`/`)
})

test('onboarding with a short code', async ({
	page,
	navigate,
	getOnboardingData,
}) => {
	const onboardingData = getOnboardingData()

	await navigate('/signup')

	const emailTextbox = page.getByRole('textbox', { name: /email/i })
	await emailTextbox.click()
	await emailTextbox.fill(onboardingData.email)

	await page.getByRole('button', { name: /email me a code/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()

	const email = await readEmail(onboardingData.email)
	invariant(email, 'Email not found')
	expect(email.to).toBe(onboardingData.email.toLowerCase())
	expect(email.from).toBe('hello@useqm.app')
	expect(email.subject).toMatch(/sign-up code/i)
	const codeMatch = email.text.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Onboarding code not found')
	expect(code).toHaveLength(8)
	// Pasted from somewhere that added a space and a dash, in lowercase.
	const codeBox = page.getByRole('textbox', { name: /code/i })
	// Emailed codes have letters, so the keyboard stays a full one.
	await expect(codeBox).toHaveAttribute('inputmode', 'text')
	await codeBox.focus()
	const pasted = `${code.slice(0, 4)} - ${code.slice(4)}`.toLowerCase()
	await codeBox.evaluate((input, text) => {
		const clipboardData = new DataTransfer()
		clipboardData.setData('text/plain', text)
		input.dispatchEvent(
			new ClipboardEvent('paste', {
				clipboardData,
				bubbles: true,
				cancelable: true,
			}),
		)
	}, pasted)
	await expect(codeBox).toHaveValue(code)
	await page.getByRole('button', { name: /submit/i }).click()

	await expect(page).toHaveURL(`/onboarding`)
	expect(
		await prisma.emailCode.count({
			where: { target: onboardingData.email.toLowerCase() },
		}),
	).toBe(0)
})

test('the signup form explains a bad username, then signs up', async ({
	page,
	navigate,
	getOnboardingData,
}) => {
	const onboardingData = getOnboardingData()
	await navigate('/signup')
	await page.getByRole('textbox', { name: /email/i }).fill(onboardingData.email)
	await page.getByRole('button', { name: /email me a code/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await readEmail(onboardingData.email)
	invariant(email, 'Email not found')
	const code = email.text.match(CODE_REGEX)?.groups?.code
	invariant(code, 'Onboarding code not found')
	await page.getByRole('textbox', { name: /code/i }).fill(code)
	await page.getByRole('button', { name: /submit/i }).click()
	await expect(page).toHaveURL('/onboarding')
	await expect(
		page.getByText(new RegExp(`signing up as ${onboardingData.email}`, 'i')),
	).toBeVisible()

	await page.getByRole('textbox', { name: /^name/i }).fill(onboardingData.name)
	await page.getByLabel(/^password/i).fill(onboardingData.password)
	await page.getByLabel(/^confirm password/i).fill(onboardingData.password)
	const usernameInput = page.getByRole('textbox', { name: /username/i })
	const createAccountButton = page.getByRole('button', {
		name: /create an account/i,
	})
	// The button shows no status until a submit fails.
	await expect(createAccountButton.getByRole('status')).not.toBeVisible()

	// $ isn't allowed (app/utils/user-validation.ts), and the terms box is
	// still unchecked.
	await usernameInput.fill('U$er_name')
	await createAccountButton.click()
	await expect(createAccountButton.getByRole('status')).toBeVisible()
	await expect(
		page.getByText(/use only letters, numbers and underscores/i),
	).toBeVisible()
	await expect(
		page.getByText(
			/agree to the terms of service and privacy policy to carry on/i,
		),
	).toBeVisible()
	await expect(page).toHaveURL('/onboarding')

	await usernameInput.fill('')
	await createAccountButton.click()
	await expect(page.getByText(/enter a username/i)).toBeVisible()

	await usernameInput.fill(
		faker.string.alphanumeric({ length: USERNAME_MIN_LENGTH - 1 }),
	)
	await createAccountButton.click()
	await expect(page.getByText(/use at least 3 characters/i)).toBeVisible()

	// The field stops at the longest allowed username.
	await usernameInput.fill(
		faker.string.alphanumeric({ length: USERNAME_MAX_LENGTH + 1 }),
	)
	expect(await usernameInput.inputValue()).toHaveLength(USERNAME_MAX_LENGTH)
	await createAccountButton.click()
	await expect(page.getByText(/use 20 characters or fewer/i)).not.toBeVisible()

	await usernameInput.fill(onboardingData.username)
	await createAccountButton.click()
	await expect(
		page.getByText(
			/agree to the terms of service and privacy policy to carry on/i,
		),
	).toBeVisible()
	await expect(page).toHaveURL('/onboarding')

	await page
		.getByLabel(/i agree to the terms of service and privacy policy/i)
		.check()
	await createAccountButton.click()
	await expect(page).toHaveURL('/recipes')
	expect(
		await prisma.user.count({
			where: { username: onboardingData.username },
		}),
	).toBe(1)
})

test('login as existing user', async ({
	page,
	navigate,
	insertRegisteredUser,
}) => {
	const password = faker.internet.password()
	const user = await insertRegisteredUser({ password })
	invariant(user.name, 'User name not found')
	await navigate('/login')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await expect(page).toHaveURL(`/recipes`)

	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
})

test('reset password with a link', async ({
	page,
	navigate,
	insertRegisteredUser,
}) => {
	const originalPassword = faker.internet.password()
	const user = await insertRegisteredUser({ password: originalPassword })
	invariant(user.name, 'User name not found')
	await navigate('/login')

	await page.getByRole('link', { name: /forgot password/i }).click()
	await expect(page).toHaveURL('/forgot-password')

	await expect(
		page.getByRole('heading', { name: /forgot password/i }),
	).toBeVisible()
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByRole('button', { name: /email me a link/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	await expect(page.getByText(/asked more than once\?/i)).toBeVisible()

	// The reset email goes out after the page has answered.
	const email = await waitFor(() => readEmail(user.email), {
		errorMessage: 'Reset email was not sent',
	})
	expect(email.subject).toMatch(/reset your quartermaster password/i)
	expect(email.to).toBe(user.email.toLowerCase())
	expect(email.from).toBe('hello@useqm.app')
	const resetPasswordUrl = extractUrl(email.text) as AppPages
	invariant(resetPasswordUrl, 'Reset password URL not found')
	// The mock writes the email before the server marks its code as sent, and
	// the code works only from then on.
	await expect
		.poll(() =>
			prisma.emailCode.count({
				where: { target: user.id, sentAt: { not: null } },
			}),
		)
		.toBe(1)
	await navigate(resetPasswordUrl)

	await expect(page).toHaveURL(/\/verify/)
	// Opening the link twice, as a mail scanner and then the owner might,
	// leaves the code in place.
	await page.reload()
	await expect(page.getByText(/your link is ready/i)).toBeVisible()
	expect(await prisma.emailCode.count({ where: { target: user.id } })).toBe(1)

	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL(`/reset-password`)
	expect(await prisma.emailCode.count({ where: { target: user.id } })).toBe(0)
	const newPassword = faker.internet.password()
	await page.getByLabel(/^new password$/i).fill(newPassword)
	await page.getByLabel(/^confirm password$/i).fill(newPassword)

	await page.getByRole('button', { name: /reset password/i }).click()

	await expect(page).toHaveURL('/login')

	// The used link no longer works, and the page asks for the code instead.
	await navigate(resetPasswordUrl)
	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()
	await expect(page.getByText(/this link didn't work/i)).toBeVisible()
	await expect(page.getByRole('textbox', { name: /code/i })).toBeVisible()
	await expect(
		page.getByRole('link', { name: /ask for a new code/i }),
	).toHaveAttribute('href', '/forgot-password')

	await navigate('/login')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(originalPassword)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()

	await expect(page.getByText(/invalid username or password/i)).toBeVisible()

	await page.getByLabel(/^password$/i).fill(newPassword)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()

	await expect(page).toHaveURL(`/recipes`)

	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
})

// Google sign-in is gone. An account that only ever used it has no password,
// and gets one through Forgot password, which proves the email first.
test('an account with no password sets one with Forgot password', async ({
	page,
	navigate,
	insertRegisteredUser,
}) => {
	const user = await insertRegisteredUser({
		password: faker.internet.password(),
	})
	await prisma.password.delete({ where: { userId: user.id } })

	await navigate('/login')
	await page.getByRole('link', { name: /forgot password/i }).click()
	await expect(page).toHaveURL('/forgot-password')
	await expect(
		page.getByRole('heading', { name: /forgot password/i }),
	).toBeVisible()
	await page.getByRole('textbox', { name: /username/i }).fill(user.email)
	await page.getByRole('button', { name: /email me a link/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await waitFor(() => readEmail(user.email), {
		errorMessage: 'Reset email was not sent',
	})
	const resetPasswordUrl = extractUrl(email.text) as AppPages
	invariant(resetPasswordUrl, 'Reset password URL not found')
	await expect
		.poll(() =>
			prisma.emailCode.count({
				where: { target: user.id, sentAt: { not: null } },
			}),
		)
		.toBe(1)
	await navigate(resetPasswordUrl)
	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL('/reset-password')
	// Login asks for the username, which someone who used Google may not know.
	await expect(
		page.getByText(`For ${user.username}`, { exact: true }),
	).toBeVisible()
	const newPassword = faker.internet.password()
	await page.getByLabel(/^new password$/i).fill(newPassword)
	await page.getByLabel(/^confirm password$/i).fill(newPassword)
	await page.getByRole('button', { name: /reset password/i }).click()
	await expect(page).toHaveURL('/login')
	expect(await prisma.password.count({ where: { userId: user.id } })).toBe(1)

	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(newPassword)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await expect(page).toHaveURL('/recipes')
})

test('login and signup offer no Google, and its old pages are gone', async ({
	page,
	navigate,
	login,
}) => {
	await navigate('/login')
	await expect(
		page.getByRole('button', { name: 'Log in', exact: true }),
	).toBeVisible()
	await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0)
	await expect(page.getByText(/google/i)).toHaveCount(0)

	await navigate('/signup')
	await expect(
		page.getByRole('button', { name: /email me a code/i }),
	).toBeVisible()
	await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0)

	const gone = [
		'/auth/google',
		'/auth/google/callback',
		'/onboarding/google',
		'/settings/profile/connections',
		'/settings/profile/password/create',
	]
	const statuses = async () =>
		Promise.all(
			gone.map(async (path) => {
				const response = await page.request.get(path, { maxRedirects: 0 })
				return [path, response.status()]
			}),
		)
	expect(Object.fromEntries(await statuses())).toEqual(
		Object.fromEntries(gone.map((path) => [path, 404])),
	)

	await login()
	expect(Object.fromEntries(await statuses())).toEqual(
		Object.fromEntries(gone.map((path) => [path, 404])),
	)
	await navigate('/settings/profile')
	await expect(page.getByRole('link', { name: /passkeys/i })).toBeVisible()
	await expect(page.getByRole('link', { name: /connections/i })).toHaveCount(0)
})

// Links from emails open in the iOS app, which is always logged in.
test('a signup link opened while logged in waits for a log out, then works', async ({
	page,
	navigate,
	login,
	getOnboardingData,
}) => {
	const onboardingData = getOnboardingData()
	await navigate('/signup')
	await page.getByRole('textbox', { name: /email/i }).fill(onboardingData.email)
	await page.getByRole('button', { name: /email me a code/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await readEmail(onboardingData.email)
	invariant(email, 'Email not found')
	const onboardingUrl = extractUrl(email.text) as AppPages
	invariant(onboardingUrl, 'Onboarding URL not found')
	const emailCodes = {
		where: { target: onboardingData.email.toLowerCase() },
	}

	const someone = await login()
	await navigate(onboardingUrl)
	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(
		page.getByRole('heading', {
			name: `You’re logged in as ${someone.username}`,
		}),
	).toBeVisible()
	expect(await prisma.emailCode.count(emailCodes)).toBe(1)

	await page.getByRole('button', { name: /log out/i }).click()
	await expect(page.getByText(/your link is ready/i)).toBeVisible()
	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL('/onboarding')
	expect(await prisma.emailCode.count(emailCodes)).toBe(0)
})

test('a reset link opened while logged in as someone else resets the right account and logs out', async ({
	page,
	navigate,
	login,
	insertRegisteredUser,
}) => {
	const user = await insertRegisteredUser({
		password: faker.internet.password(),
	})
	await navigate('/forgot-password')
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByRole('button', { name: /email me a link/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await waitFor(() => readEmail(user.email), {
		errorMessage: 'Reset email was not sent',
	})
	const resetPasswordUrl = extractUrl(email.text) as AppPages
	invariant(resetPasswordUrl, 'Reset password URL not found')
	await expect
		.poll(() =>
			prisma.emailCode.count({
				where: { target: user.id, sentAt: { not: null } },
			}),
		)
		.toBe(1)

	const someoneElse = await login()
	await navigate(resetPasswordUrl)
	await page
		.getByRole('main')
		.getByRole('button', { name: /submit/i })
		.click()

	await expect(page).toHaveURL('/reset-password')
	await expect(
		page.getByText(`For ${user.username}`, { exact: true }),
	).toBeVisible()
	await expect(page.getByText(/logs this device out/i)).toBeVisible()
	const newPassword = faker.internet.password()
	await page.getByLabel(/^new password$/i).fill(newPassword)
	await page.getByLabel(/^confirm password$/i).fill(newPassword)
	await page.getByRole('button', { name: /reset password/i }).click()

	await expect(page).toHaveURL('/login')
	expect(
		await prisma.session.count({ where: { userId: someoneElse.id } }),
	).toBe(0)
	await navigate('/recipes')
	await expect(page).toHaveURL(/\/login/)

	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(newPassword)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await expect(page).toHaveURL('/recipes')
})
