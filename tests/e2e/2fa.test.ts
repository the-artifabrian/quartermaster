import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import { createOwnHousehold, getPasswordHash } from '#app/utils/auth.server.ts'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import {
	createUser,
	expect,
	hydrated,
	test,
	waitFor,
} from '#tests/playwright-utils.ts'

test('Users can add 2FA to their account and use it when logging in', async ({
	page,
	navigate,
	login,
}) => {
	const password = faker.internet.password()
	const user = await login({ password })
	await navigate('/settings/profile')

	await page.getByRole('link', { name: /^two-factor auth/i }).click()

	await expect(page).toHaveURL(`/settings/profile/two-factor`)
	const main = page.getByRole('main')
	await main.getByRole('button', { name: /enable 2fa/i }).click()
	const otpUriString = await main
		.getByLabel(/One-Time Password URI/i)
		.innerText()

	// Click events record an element's text and attributes, so the secret
	// and its QR code are kept out of them.
	await expect(main.getByRole('img', { name: 'qr code' })).toHaveClass(
		/\bph-no-capture\b/,
	)
	await expect(main.getByLabel(/One-Time Password URI/i)).toHaveClass(
		/\bph-no-capture\b/,
	)

	const otpUri = new URL(otpUriString)
	const options = Object.fromEntries(otpUri.searchParams)

	// Authenticator codes are digits, so phones show the number pad.
	await expect(main.getByRole('textbox', { name: /code/i })).toHaveAttribute(
		'inputmode',
		'numeric',
	)
	await main.getByRole('textbox', { name: /code/i }).fill(
		(
			await generateTOTP({
				...options,
				// the algorithm will be "SHA1" but we need to generate the OTP with "SHA-1"
				algorithm: 'SHA-1',
			})
		).otp,
	)
	await main.getByRole('button', { name: /submit/i }).click()

	await expect(main).toHaveText(/Two-factor authentication is on./i)
	await expect(main.getByRole('link', { name: /disable 2fa/i })).toBeVisible()

	await navigate('/settings/profile')
	await page.getByRole('button', { name: /log out/i }).click()
	await expect(page).toHaveURL(`/`)

	await navigate('/login')
	await expect(page).toHaveURL(`/login`)
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()

	await expect(page.getByRole('textbox', { name: /code/i })).toHaveAttribute(
		'inputmode',
		'numeric',
	)
	await page.getByRole('textbox', { name: /code/i }).fill(
		(
			await generateTOTP({
				...options,
				// the algorithm will be "SHA1" but we need to generate the OTP with "SHA-1"
				algorithm: 'SHA-1',
			})
		).otp,
	)

	await page.getByRole('button', { name: /submit/i }).click()

	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
})

test('Reverifying from Settings lands on the page the user opened, not its data', async ({
	page,
	navigate,
	login,
}) => {
	const user = await login()
	// Two-factor is on, and this session has not verified recently.
	const { otp: _otp, ...totpConfig } = await generateTOTP()
	await prisma.verification.create({
		data: { ...totpConfig, type: '2fa', target: user.id },
	})

	await navigate('/settings/profile')
	const emailRow = page.getByRole('link', { name: `Email ${user.email}` })
	await hydrated(emailRow)
	// A client navigation: the router asks for the page's data.
	const dataRequest = page.waitForRequest((request) =>
		new URL(request.url()).pathname.endsWith('/change-email.data'),
	)
	await emailRow.click()
	await dataRequest

	await expect(page).toHaveURL(/\/verify\?/)
	await page
		.getByRole('textbox', { name: /code/i })
		.fill((await generateTOTP(totpConfig)).otp)
	await page.getByRole('button', { name: /submit/i }).click()

	await expect(page).toHaveURL('/settings/profile/change-email')
	await expect(page.getByRole('textbox', { name: 'New email' })).toBeVisible()
	await expect(page.getByText(user.email)).toBeVisible()
})

// Moves this browser's last 2FA verification back in time, as if it happened
// `hoursAgo` hours ago.
async function ageVerification(page: Page, hoursAgo: number) {
	const cookies = await page.context().cookies()
	const authCookie = cookies.find((cookie) => cookie.name === 'en_session')
	invariant(authCookie, 'Not signed in')
	const authSession = await authSessionStorage.getSession(
		`en_session=${authCookie.value}`,
	)
	authSession.set('verified-time', Date.now() - hoursAgo * 60 * 60 * 1000)
	const committed = await authSessionStorage.commitSession(authSession)
	const value = committed.split(';')[0]!.slice('en_session='.length)
	await page.context().addCookies([{ ...authCookie, value }])
}

test('A change of email survives a reverify in the middle', async ({
	page,
	navigate,
	login,
}) => {
	const user = await login()
	const { otp: _otp, ...totpConfig } = await generateTOTP()
	// Verification rows aren't tied to the user, so the test removes its own.
	await prisma.verification.create({
		data: { ...totpConfig, type: '2fa', target: user.id },
	})
	try {
		const enterTOTP = async () => {
			await expect(page.getByText(/check your 2fa app/i)).toBeVisible()
			await page
				.getByRole('textbox', { name: /code/i })
				.fill((await generateTOTP(totpConfig)).otp)
			await page.getByRole('button', { name: /submit/i }).click()
		}

		await navigate('/settings/profile/change-email')
		await enterTOTP()
		await expect(page).toHaveURL('/settings/profile/change-email')

		const newEmailAddress = faker.internet.email().toLowerCase()
		await page
			.getByRole('textbox', { name: /new email/i })
			.fill(newEmailAddress)
		// The login fixture's password is the username.
		await page.getByLabel(/^current password$/i).fill(user.username)
		await page.getByRole('button', { name: /send confirmation/i }).click()
		await expect(page.getByText(/check your email/i)).toBeVisible()
		const email = await waitFor(() => readEmail(newEmailAddress), {
			errorMessage: 'Confirmation email was not sent',
		})
		const code = email.text.match(
			/Here's your verification code: (?<code>[\d\w]+)/,
		)?.groups?.code
		invariant(code, 'Code not found in the email')

		// The code arrives after this browser's verification has gone stale.
		await ageVerification(page, 3)
		await page.getByRole('textbox', { name: /code/i }).fill(code)
		await page.getByRole('button', { name: /submit/i }).click()

		await enterTOTP()
		// Back on the email step, the same code still works.
		await expect(page.getByText(/check your email/i)).toBeVisible()
		await page.getByRole('textbox', { name: /code/i }).fill(code)
		await page.getByRole('button', { name: /submit/i }).click()

		await expect(page.getByText(/email changed/i)).toBeVisible()
		await expect(page).toHaveURL('/settings/profile')
		expect(
			await prisma.user.findUniqueOrThrow({
				where: { id: user.id },
				select: { email: true },
			}),
		).toEqual({ email: newEmailAddress })
	} finally {
		await prisma.verification.deleteMany({ where: { target: user.id } })
	}
})

test('A 2FA sign-in left at the code step does not hold up the next person on the same browser', async ({
	page,
	navigate,
	insertNewUser,
}) => {
	// Someone with 2FA signs in and walks away at the code step.
	const walkedAway = await insertNewUser()
	const { otp: _otp, ...totpConfig } = await generateTOTP()
	await prisma.verification.create({
		data: { ...totpConfig, type: '2fa', target: walkedAway.id },
	})
	// The next person has no 2FA. Their password is their username.
	const nextPerson = await prisma.user.create({
		data: {
			...createUser(),
			roles: { connect: { name: 'user' } },
		},
		select: { id: true, username: true, name: true },
	})
	await prisma.password.create({
		data: {
			userId: nextPerson.id,
			hash: await getPasswordHash(nextPerson.username),
		},
	})
	const household = await createOwnHousehold(prisma, nextPerson)
	try {
		await navigate('/login')
		await page
			.getByRole('textbox', { name: /username/i })
			.fill(walkedAway.username)
		await page.getByLabel(/^password$/i).fill(walkedAway.username)
		await page.getByRole('button', { name: 'Log in', exact: true }).click()
		await expect(page).toHaveURL(/\/verify\?/)

		await navigate('/login')
		await page
			.getByRole('textbox', { name: /username/i })
			.fill(nextPerson.username)
		await page.getByLabel(/^password$/i).fill(nextPerson.username)
		await page.getByRole('button', { name: 'Log in', exact: true }).click()
		await expect(page).toHaveURL('/recipes')

		await navigate('/settings/profile/change-email')
		await expect(page).toHaveURL('/settings/profile/change-email')
		await expect(page.getByRole('textbox', { name: 'New email' })).toBeVisible()
		expect(
			(await page.context().cookies()).some(
				(cookie) => cookie.name === 'en_verification',
			),
		).toBe(false)
	} finally {
		await prisma.verification.deleteMany({ where: { target: walkedAway.id } })
		await prisma.user.delete({ where: { id: nextPerson.id } })
		await prisma.household.delete({ where: { id: household.id } })
	}
})
