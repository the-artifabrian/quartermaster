import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import { createOwnHousehold } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	normalizeEmail,
	normalizeUsername,
} from '#app/utils/providers/provider.ts'
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

/**
 * Hidden fields that can carry an invite token or an email address (redirectTo,
 * target) are blocked from session replays with ph-no-capture, so they stay
 * out whatever the PostHog project's masking settings say.
 */
async function expectHiddenFieldsBlocked(page: Page, names: string[]) {
	for (const name of names) {
		// eslint-disable-next-line playwright/no-raw-locators -- hidden inputs have no role
		const input = page.locator(`input[type="hidden"][name="${name}"]`)
		await expect(input, name).toHaveClass(/\bph-no-capture\b/)
	}
}

test('onboarding with link', async ({ page, navigate, getOnboardingData }) => {
	const onboardingData = getOnboardingData()

	await navigate('/')

	await page.getByRole('link', { name: /log in/i }).click()
	await expect(page).toHaveURL(`/login`)
	await expectHiddenFieldsBlocked(page, ['redirectTo'])

	const createAccountLink = page.getByRole('link', {
		name: /create an account/i,
	})
	await createAccountLink.click()

	await expect(page).toHaveURL(`/signup`)
	await expectHiddenFieldsBlocked(page, ['redirectTo'])

	const emailTextbox = page.getByRole('textbox', { name: /email/i })
	await emailTextbox.click()
	await emailTextbox.fill(onboardingData.email)

	await page.getByRole('button', { name: /submit/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	await expect(page.getByText(/asked more than once\?/i)).toBeVisible()

	const email = await readEmail(onboardingData.email)
	invariant(email, 'Email not found')
	expect(email.to).toBe(onboardingData.email.toLowerCase())
	expect(email.from).toBe('hello@useqm.app')
	expect(email.subject).toMatch(/welcome/i)
	const onboardingUrl = extractUrl(email.text) as AppPages
	invariant(onboardingUrl, 'Onboarding URL not found')
	expect(new URL(onboardingUrl).searchParams.get('code')).toBeNull()
	await navigate(onboardingUrl)

	await expect(page).toHaveURL(/\/verify/)
	await expectHiddenFieldsBlocked(page, ['target', 'redirectTo', 'token'])
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
	await expectHiddenFieldsBlocked(page, ['redirectTo'])
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

	await page.getByRole('button', { name: /submit/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()

	const email = await readEmail(onboardingData.email)
	invariant(email, 'Email not found')
	expect(email.to).toBe(onboardingData.email.toLowerCase())
	expect(email.from).toBe('hello@useqm.app')
	expect(email.subject).toMatch(/welcome/i)
	const codeMatch = email.text.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Onboarding code not found')
	expect(code).toHaveLength(8)
	// Pasted from somewhere that added a space and a dash, in lowercase.
	const codeBox = page.getByRole('textbox', { name: /code/i })
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

test('completes onboarding after Google OAuth given valid user details', async ({
	page,
	navigate,
	prepareGoogleUser,
}) => {
	const googleUser = await prepareGoogleUser()

	// let's verify we do not have user with that email in our system:
	expect(
		await prisma.user.findUnique({
			where: { email: normalizeEmail(googleUser.primaryEmail) },
		}),
	).toBeNull()

	await navigate('/signup')
	await page.getByRole('button', { name: /sign up with google/i }).click()

	await expect(page).toHaveURL(/\/onboarding\/google/)
	await expect(
		page.getByText(
			new RegExp(`welcome aboard ${googleUser.primaryEmail}`, 'i'),
		),
	).toBeVisible()

	// fields are pre-populated for the user, so we only need to accept
	// terms of service and hit the 'create an account' button
	const usernameInput = page.getByRole('textbox', { name: /username/i })
	await expect(usernameInput).toHaveValue(
		normalizeUsername(googleUser.primaryEmail.split('@')[0]!),
	)
	await expect(page.getByRole('textbox', { name: /^name/i })).toHaveValue(
		googleUser.profile.name,
	)
	const createAccountButton = page.getByRole('button', {
		name: /create an account/i,
	})

	await page.waitForLoadState('networkidle') // ensure js is fully loaded.
	await page
		.getByLabel(/do you agree to our terms of service and privacy policy/i)
		.check()
	await createAccountButton.click()

	await expect(page).toHaveURL('/recipes')
	await expect(page.getByText(/14 days of full Pro access/i)).toBeVisible()

	// internally, a user has been created:
	await prisma.user.findUniqueOrThrow({
		where: { email: normalizeEmail(googleUser.primaryEmail) },
	})
})

test('logs user in after Google OAuth if they are already registered', async ({
	page,
	navigate,
	prepareGoogleUser,
}) => {
	const googleUser = await prepareGoogleUser()

	// let's verify we do not have user with that email in our system ...
	expect(
		await prisma.user.findUnique({
			where: { email: normalizeEmail(googleUser.primaryEmail) },
		}),
	).toBeNull()
	// ... and create one:
	const name = faker.person.fullName()
	const user = await prisma.user.create({
		select: { id: true, name: true, username: true },
		data: {
			email: normalizeEmail(googleUser.primaryEmail),
			username: normalizeUsername(googleUser.primaryEmail.split('@')[0]!),
			name,
		},
	})
	// A registered user signed up, so they already have a Household.
	await createOwnHousehold(prisma, user)

	// let's verify there is no connection between the Google user
	// and our app's user:
	const connection = await prisma.connection.findFirst({
		where: { providerName: 'google', userId: user.id },
	})
	expect(connection).toBeNull()

	await navigate('/signup')
	await page.getByRole('button', { name: /sign up with google/i }).click()

	await expect(page).toHaveURL(`/recipes`)
	await expect(
		page.getByText(
			new RegExp(
				`your "${googleUser.primaryEmail.split('@')[0]}" google account has been connected`,
				'i',
			),
		),
	).toBeVisible()

	// internally, a connection (rather than a new user) has been created:
	await prisma.connection.findFirstOrThrow({
		where: { providerName: 'google', userId: user.id },
	})
})

test('shows help texts on entering invalid details on onboarding page after Google OAuth', async ({
	page,
	navigate,
	prepareGoogleUser,
}) => {
	const googleUser = await prepareGoogleUser()

	await navigate('/signup')
	await page.getByRole('button', { name: /sign up with google/i }).click()

	await expect(page).toHaveURL(/\/onboarding\/google/)
	await expect(
		page.getByText(
			new RegExp(`welcome aboard ${googleUser.primaryEmail}`, 'i'),
		),
	).toBeVisible()

	const usernameInput = page.getByRole('textbox', { name: /username/i })

	// notice, how button is currently in 'idle' (neutral) state and so has got no companion
	const createAccountButton = page.getByRole('button', {
		name: /create an account/i,
	})
	await expect(createAccountButton.getByRole('status')).not.toBeVisible()
	await expect(createAccountButton.getByText('error')).not.toBeAttached()

	// invalid chars in username
	await usernameInput.fill('U$er_name') // $ is invalid char, see app/utils/user-validation.ts.
	await createAccountButton.click()

	await expect(createAccountButton.getByRole('status')).toBeVisible()
	await expect(createAccountButton.getByText('error')).toBeAttached()
	await expect(
		page.getByText(
			/username can only include letters, numbers, and underscores/i,
		),
	).toBeVisible()
	// but we also never checked that privacy consent box
	await expect(
		page.getByText(
			/you must agree to the terms of service and privacy policy/i,
		),
	).toBeVisible()
	await expect(page).toHaveURL(/\/onboarding\/google/)

	// empty username
	await usernameInput.fill('')
	await createAccountButton.click()
	await expect(page.getByText(/username is required/i)).toBeVisible()
	await expect(page).toHaveURL(/\/onboarding\/google/)

	// too short username
	await usernameInput.fill(
		faker.string.alphanumeric({ length: USERNAME_MIN_LENGTH - 1 }),
	)
	await createAccountButton.click()
	await expect(page.getByText(/username is too short/i)).toBeVisible()

	// too long username
	await usernameInput.fill(
		faker.string.alphanumeric({
			length: USERNAME_MAX_LENGTH + 1,
		}),
	)
	// we are truncating the user's input
	expect(await usernameInput.inputValue()).toHaveLength(USERNAME_MAX_LENGTH)
	await createAccountButton.click()
	await expect(page.getByText(/username is too long/i)).not.toBeVisible()

	// still unchecked 'terms of service' checkbox
	await usernameInput.fill(
		normalizeUsername(`U5er_name_0k_${faker.person.lastName()}`),
	)
	await createAccountButton.click()
	await expect(
		page.getByText(/must agree to the terms of service and privacy policy/i),
	).toBeVisible()
	await expect(page).toHaveURL(/\/onboarding\/google/)

	// we are all set up and ...

	await page.waitForLoadState('networkidle') // ensure js is fully loaded.
	await page
		.getByLabel(/do you agree to our terms of service and privacy policy/i)
		.check()
	await createAccountButton.click()
	await expect(createAccountButton.getByText('error')).not.toBeAttached()

	// ... sign up is successful!
	await expect(page.getByText(/14 days of full Pro access/i)).toBeVisible()
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
	await page.getByRole('button', { name: /recover password/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	await expect(page.getByText(/asked more than once\?/i)).toBeVisible()

	// The reset email goes out after the page has answered.
	const email = await waitFor(() => readEmail(user.email), {
		errorMessage: 'Reset email was not sent',
	})
	expect(email.subject).toMatch(/password reset/i)
	expect(email.to).toBe(user.email.toLowerCase())
	expect(email.from).toBe('hello@useqm.app')
	const resetPasswordUrl = extractUrl(email.text) as AppPages
	invariant(resetPasswordUrl, 'Reset password URL not found')
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
