import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import { readEmail } from '#tests/mocks/utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test, waitFor } from '#tests/playwright-utils.ts'

// What can go wrong for someone adding a passkey in Settings:
// - Closing the passkey prompt shows an error, or clears the password.
// - After a closed prompt (or one iOS refused because the tap was too long
//   ago), there's no way to try again without retyping the password.
// - A wrong password still opens the prompt, or shows no error.
// - The right password doesn't save the passkey, or sends no notice.
// - Adding the same device twice gives a vague error.

// A `usb` authenticator leaves passkey autofill off in Chromium. An
// `internal` one stands in for the phone's own passkeys: autofill is on, and
// with presence simulated it answers the autofill request by itself.
async function setupWebAuthn(
	page: Page,
	{ transport = 'usb' }: { transport?: 'usb' | 'internal' } = {},
) {
	const client = await page.context().newCDPSession(page)
	// https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
	await client.send('WebAuthn.enable', { enableUI: true })
	const result = await client.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport,
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	})
	return { client, authenticatorId: result.authenticatorId }
}

async function addPasskey(page: Page, password: string) {
	await page.getByLabel('Current password').fill(password)
	await page.getByRole('button', { name: /register new passkey/i }).click()
}

test('Users can register and use passkeys', async ({
	page,
	navigate,
	login,
}) => {
	const password = faker.internet.password()
	const user = await login({ password })

	const { client, authenticatorId } = await setupWebAuthn(page)

	const initialCredentials = await client.send('WebAuthn.getCredentials', {
		authenticatorId,
	})
	expect(
		initialCredentials.credentials,
		'No credentials should exist initially',
	).toHaveLength(0)

	await navigate('/settings/profile/passkeys')

	const passkeyRegisteredPromise = new Promise<void>((resolve) => {
		client.once('WebAuthn.credentialAdded', () => resolve())
	})
	await addPasskey(page, password)
	await passkeyRegisteredPromise

	// Verify the passkey appears in the UI
	await expect(page.getByRole('list', { name: /passkeys/i })).toBeVisible()
	await expect(page.getByText(/registered .* ago/i)).toBeVisible()
	await expect(page.getByLabel('Current password')).toHaveValue('')

	const afterRegistrationCredentials = await client.send(
		'WebAuthn.getCredentials',
		{ authenticatorId },
	)
	expect(
		afterRegistrationCredentials.credentials,
		'One credential should exist after registration',
	).toHaveLength(1)
	await expect
		.poll(() =>
			prisma.passkey.findMany({
				where: { userId: user.id },
				select: { userId: true },
			}),
		)
		.toEqual([{ userId: user.id }])
	const notice = await waitFor(() => readEmail(user.email), {
		errorMessage: 'The passkey notice was not sent',
	})
	expect(notice.subject).toMatch(/passkey was added/i)

	// Logout
	await navigate('/settings/profile')
	await page.getByRole('button', { name: /log out/i }).click()
	await expect(page).toHaveURL(`/`)

	// Try logging in with passkey. The login page has an autofill request
	// waiting; the button cancels it without showing an error.
	await navigate('/login')
	const signCount1 = afterRegistrationCredentials.credentials[0]!.signCount

	const passkeyAssertedPromise = new Promise<void>((resolve) => {
		client.once('WebAuthn.credentialAsserted', () => resolve())
	})

	await page.getByRole('button', { name: /log in with a passkey/i }).click()

	// Check for error message before waiting for completion
	const errorLocator = page.getByText(/failed to authenticate/i)
	const errorPromise = errorLocator.waitFor({ timeout: 1000 }).then(() => {
		throw new Error('Passkey authentication failed')
	})

	await Promise.race([passkeyAssertedPromise, errorPromise])

	// Verify successful login
	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

	// Verify the sign count increased
	const afterLoginCredentials = await client.send('WebAuthn.getCredentials', {
		authenticatorId,
	})
	expect(afterLoginCredentials.credentials).toHaveLength(1)
	expect(afterLoginCredentials.credentials[0]?.signCount).toBeGreaterThan(
		signCount1,
	)

	// Go to passkeys page and delete the passkey
	await navigate('/settings/profile/passkeys')
	await page.getByRole('button', { name: 'Delete', exact: true }).click()
	await page
		.getByRole('dialog', { name: 'Delete this passkey?' })
		.getByRole('button', { name: 'Delete passkey' })
		.click()

	// Verify the passkey is no longer listed on the page
	await expect(page.getByText(/no passkeys registered/i)).toBeVisible()
	await expect
		.poll(() => prisma.passkey.count({ where: { userId: user.id } }))
		.toBe(0)

	// The page tells the browser which passkeys the account still has, and
	// the authenticator drops the deleted one.
	const credentialCount = async () =>
		(await client.send('WebAuthn.getCredentials', { authenticatorId }))
			.credentials.length
	await expect.poll(credentialCount).toBe(0)
	// Put it back to try signing in with a passkey the server no longer knows.
	await client.send('WebAuthn.addCredential', {
		authenticatorId,
		credential: afterRegistrationCredentials.credentials[0]!,
	})

	// Logout again to test deleted passkey
	await navigate('/settings/profile')
	await page.getByRole('button', { name: /log out/i }).click()
	await expect(page).toHaveURL(`/`)

	// Try logging in with the deleted passkey
	await navigate('/login')
	const deletedPasskeyAssertedPromise = new Promise<void>((resolve) => {
		client.once('WebAuthn.credentialAsserted', () => resolve())
	})

	await page.getByRole('button', { name: /log in with a passkey/i }).click()

	await deletedPasskeyAssertedPromise

	// Verify error message appears
	await expect(page.getByText(/passkey not found/i)).toBeVisible()

	// Verify we're still on the login page
	await expect(page).toHaveURL(`/login`)
	// The server's 404 has the browser forget the passkey.
	await expect.poll(credentialCount).toBe(0)
})

test('A wrong password shows an error and opens no passkey prompt', async ({
	page,
	navigate,
	login,
}) => {
	const user = await login({ password: faker.internet.password() })
	const { client, authenticatorId } = await setupWebAuthn(page)
	await navigate('/settings/profile/passkeys')

	await addPasskey(page, 'not-my-password')

	await expect(page.getByText(/incorrect password/i)).toBeVisible()
	const credentials = await client.send('WebAuthn.getCredentials', {
		authenticatorId,
	})
	expect(credentials.credentials).toHaveLength(0)
	expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(0)
})

test('Closing the passkey prompt shows no error, and one tap tries again', async ({
	page,
	navigate,
	login,
}) => {
	const password = faker.internet.password()
	const user = await login({ password })
	const { client, authenticatorId } = await setupWebAuthn(page)
	// An authenticator that can't verify the user refuses the request with
	// NotAllowedError, the same answer as the person closing the prompt.
	await client.send('WebAuthn.setUserVerified', {
		authenticatorId,
		isUserVerified: false,
	})
	await page.addInitScript(() => {
		const create = navigator.credentials.create.bind(navigator.credentials)
		navigator.credentials.create = (options) =>
			create(options).catch((error: Error) => {
				document.documentElement.dataset.passkeyError = error.name
				throw error
			})
	})
	await navigate('/settings/profile/passkeys')

	await addPasskey(page, password)

	await expect(page.locator('html')).toHaveAttribute(
		'data-passkey-error',
		'NotAllowedError',
	)
	const tryAgain = page.getByRole('button', {
		name: 'Add passkey',
		exact: true,
	})
	await expect(tryAgain).toBeEnabled()
	await expect(page.getByText(/password is confirmed/i)).toBeVisible()
	await expect(page.getByRole('alert')).toHaveCount(0)
	await expect(page.getByText(/couldn’t|failed|error/i)).toHaveCount(0)
	await expect(page.getByText(/no passkeys registered/i)).toBeVisible()
	expect(
		(await client.send('WebAuthn.getCredentials', { authenticatorId }))
			.credentials,
	).toHaveLength(0)
	expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(0)

	// The second tap reuses the checked password's challenge.
	await client.send('WebAuthn.setUserVerified', {
		authenticatorId,
		isUserVerified: true,
	})
	const added = new Promise<void>((resolve) => {
		client.once('WebAuthn.credentialAdded', () => resolve())
	})
	await tryAgain.click()
	await added

	await expect(page.getByText(/registered .* ago/i)).toBeVisible()
	await expect(page.getByRole('alert')).toHaveCount(0)
	await expect(page.getByLabel('Current password')).toHaveValue('')
	await expect
		.poll(() => prisma.passkey.count({ where: { userId: user.id } }))
		.toBe(1)
})

test('Adding a passkey from the same device again says it already has one', async ({
	page,
	navigate,
	login,
}) => {
	const password = faker.internet.password()
	const user = await login({ password })
	const { client } = await setupWebAuthn(page)
	await navigate('/settings/profile/passkeys')

	const added = new Promise<void>((resolve) => {
		client.once('WebAuthn.credentialAdded', () => resolve())
	})
	await addPasskey(page, password)
	await added
	await expect(page.getByText(/registered .* ago/i)).toBeVisible()

	await addPasskey(page, password)
	await expect(
		page.getByText('This device already has a passkey for your account.'),
	).toBeVisible()
	expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(1)
})

async function signUpWithPasskey(
	page: Page,
	login: (options: { password: string }) => Promise<unknown>,
) {
	const password = faker.internet.password()
	await login({ password })
	const webauthn = await setupWebAuthn(page, { transport: 'internal' })
	await page.goto('/settings/profile/passkeys')
	await addPasskey(page, password)
	await expect(page.getByText(/registered .* ago/i)).toBeVisible()
	await page.context().clearCookies()
	return webauthn
}

test('A saved passkey offered on the username field logs in', async ({
	page,
	login,
}) => {
	const { client } = await signUpWithPasskey(page, login)
	const asserted = new Promise<void>((resolve) => {
		client.once('WebAuthn.credentialAsserted', () => resolve())
	})

	await page.goto('/login')

	await asserted
	await expect(page).toHaveURL('/recipes')
	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
})

test('The passkey button, even tapped twice, takes over from a waiting autofill request', async ({
	page,
	login,
}) => {
	const { client, authenticatorId } = await signUpWithPasskey(page, login)
	const warnings: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'warning' || message.type() === 'error') {
			warnings.push(message.text())
		}
	})
	// No presence, so the autofill request waits on the page.
	await client.send('WebAuthn.setAutomaticPresenceSimulation', {
		authenticatorId,
		enabled: false,
	})
	const autofillOptions = page.waitForResponse('**/webauthn/authentication')
	await page.goto('/login')
	await autofillOptions
	await expect(page).toHaveURL('/login')

	await client.send('WebAuthn.setAutomaticPresenceSimulation', {
		authenticatorId,
		enabled: true,
	})
	await page.getByRole('button', { name: /log in with a passkey/i }).dblclick()

	await expect(page).toHaveURL('/recipes')
	await expect(page.getByText(/failed to authenticate/i)).toHaveCount(0)
	expect(warnings.filter((text) => /passkey|webauthn/i.test(text))).toEqual([])
})
