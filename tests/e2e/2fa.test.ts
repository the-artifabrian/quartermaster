import { faker } from '@faker-js/faker'
import { generateTOTP } from '#app/utils/totp.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

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

	const otpUri = new URL(otpUriString)
	const options = Object.fromEntries(otpUri.searchParams)

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

	await expect(main).toHaveText(/You have enabled two-factor authentication./i)
	await expect(main.getByRole('link', { name: /disable 2fa/i })).toBeVisible()

	await navigate('/settings/profile')
	await page.getByRole('button', { name: /log out/i }).click()
	await expect(page).toHaveURL(`/`)

	await navigate('/login')
	await expect(page).toHaveURL(`/login`)
	await page.getByRole('textbox', { name: /username/i }).fill(user.username)
	await page.getByLabel(/^password$/i).fill(password)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()

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
	await expect
		.poll(() =>
			emailRow.evaluate((element) =>
				Object.keys(element).some((key) => key.startsWith('__reactProps')),
			),
		)
		.toBe(true)
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
	await expect(page.getByRole('textbox', { name: 'New Email' })).toBeVisible()
	await expect(page.getByText(user.email)).toBeVisible()
})
