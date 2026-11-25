import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { type Page } from '@playwright/test'
import {
	getSessionExpirationDate,
	verifyUserPassword,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import {
	animationsFinished,
	createUser,
	expect,
	expectThumbSized,
	expectThumbTall,
	test,
	waitFor,
} from '#tests/playwright-utils.ts'

const CODE_REGEX = /Here's your verification code: (?<code>[\d\w]+)/

test('Users can update their basic info', async ({ page, navigate, login }) => {
	const user = await login()
	await navigate('/settings/profile/edit')

	const newUserData = createUser()

	await page.getByRole('textbox', { name: /^name/i }).fill(newUserData.name)
	await page
		.getByRole('textbox', { name: /^username/i })
		.fill(newUserData.username)

	await page.getByRole('button', { name: /^save/i }).click()

	await expect
		.poll(() =>
			prisma.user.findUnique({
				where: { id: user.id },
				select: { name: true, username: true },
			}),
		)
		.toEqual({ name: newUserData.name, username: newUserData.username })
})

test('Users can update their password', async ({ page, navigate, login }) => {
	const oldPassword = faker.internet.password()
	const newPassword = faker.internet.password()
	const user = await login({ password: oldPassword })
	// The same user signed in on another device.
	const otherDevice = await prisma.session.create({
		data: { expirationDate: getSessionExpirationDate(), userId: user.id },
		select: { id: true },
	})
	await navigate('/settings/profile')

	await page.getByRole('link', { name: /^password$/i }).click()

	await page
		.getByRole('textbox', { name: /^current password/i })
		.fill(oldPassword)
	await page.getByRole('textbox', { name: /^new password/i }).fill(newPassword)
	await page
		.getByRole('textbox', { name: /^confirm new password/i })
		.fill(newPassword)

	await page.getByRole('button', { name: /^change password/i }).click()

	await expect(page).toHaveURL(`/settings/profile`)
	// This device stays signed in; the other one is signed out.
	await navigate('/settings/profile/password')
	await expect(page).toHaveURL('/settings/profile/password')
	await expect(
		page.getByRole('textbox', { name: /^current password/i }),
	).toBeVisible()
	expect(
		await prisma.session.findMany({
			where: { userId: user.id },
			select: { id: true },
		}),
	).toEqual([expect.not.objectContaining({ id: otherDevice.id })])

	const { username } = user
	expect(
		await verifyUserPassword({ username }, oldPassword),
		'Old password still works',
	).toBeNull()
	expect(
		await verifyUserPassword({ username }, newPassword),
		'New password does not work',
	).toEqual({ id: user.id })
})

test('Users can change their email address', async ({
	page,
	navigate,
	login,
}) => {
	const preUpdateUser = await login()
	const newEmailAddress = faker.internet.email().toLowerCase()
	expect(preUpdateUser.email).not.toEqual(newEmailAddress)
	await navigate('/settings/profile')
	await page.getByRole('link', { name: /^email/i }).click()
	await page.getByRole('textbox', { name: /new email/i }).fill(newEmailAddress)

	const currentPassword = page.getByLabel(/^current password$/i)
	await expect(currentPassword).toHaveAttribute(
		'autocomplete',
		'current-password',
	)
	await expect(currentPassword).toHaveAttribute('required')
	// A wrong password sends nothing.
	await currentPassword.fill('not-the-password')
	await page.getByRole('button', { name: /send confirmation/i }).click()
	await expect(page.getByText('Incorrect password.')).toBeVisible()
	await expect(page).toHaveURL('/settings/profile/change-email')
	expect(
		await prisma.emailCode.count({
			where: { target: preUpdateUser.id, type: 'change-email' },
		}),
	).toBe(0)

	// The login fixture's password is the username.
	await page.getByLabel(/^current password$/i).fill(preUpdateUser.username)
	await page.getByRole('button', { name: /send confirmation/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await waitFor(() => readEmail(newEmailAddress), {
		errorMessage: 'Confirmation email was not sent',
	})
	invariant(email, 'Email was not sent')
	const codeMatch = email.text.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Onboarding code not found')
	await page.getByRole('textbox', { name: /code/i }).fill(code)
	await page.getByRole('button', { name: /submit/i }).click()
	await expect(page.getByText(/email changed/i)).toBeVisible()

	const updatedUser = await prisma.user.findUnique({
		where: { id: preUpdateUser.id },
		select: { email: true },
	})
	invariant(updatedUser, 'Updated user not found')
	expect(updatedUser.email).toBe(newEmailAddress)
	const noticeEmail = await waitFor(() => readEmail(preUpdateUser.email), {
		errorMessage: 'Notice email was not sent',
	})
	expect(noticeEmail.subject).toContain('changed')
})

test('Deleting an account leaves the Household with the other member', async ({
	page,
	navigate,
	login,
	insertNewUser,
}) => {
	const user = await login()
	const partner = await insertNewUser()
	await prisma.user.update({
		where: { id: partner.id },
		data: { name: 'Robin Partner' },
	})
	await prisma.householdMember.create({
		data: { householdId: user.householdId, userId: partner.id, role: 'member' },
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Shared lasagne',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	await navigate('/settings/profile')

	await expect(
		page.getByText('Your Recipes and Shopping stay with Robin Partner.'),
	).toBeVisible()
	await page.getByRole('button', { name: 'Delete my account' }).click()
	await page
		.getByRole('dialog', { name: 'Delete your account?' })
		.getByRole('button', { name: 'Delete account' })
		.click()
	await expect(page).toHaveURL('/')

	await expect.poll(() => prisma.user.count({ where: { id: user.id } })).toBe(0)
	expect(
		await prisma.recipe.findUnique({
			where: { id: recipe.id },
			select: { userId: true, householdId: true },
		}),
	).toEqual({ userId: partner.id, householdId: user.householdId })
	expect(
		await prisma.householdMember.findMany({
			where: { householdId: user.householdId },
			select: { userId: true, role: true },
		}),
	).toEqual([{ userId: partner.id, role: 'owner' }])
})

test('Deleting the only member deletes the Household', async ({
	page,
	navigate,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Solo soup',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	await navigate('/settings/profile')

	await expect(
		page.getByText(
			'This deletes the Household and everything in it: Recipes, Menus, Plan, Staples and Shopping.',
		),
	).toBeVisible()
	await page.getByRole('button', { name: 'Delete my account' }).click()
	await page
		.getByRole('dialog', { name: 'Delete your account?' })
		.getByRole('button', { name: 'Delete account' })
		.click()
	await expect(page).toHaveURL('/')

	await expect
		.poll(() => prisma.household.count({ where: { id: user.householdId } }))
		.toBe(0)
	expect(await prisma.user.count({ where: { id: user.id } })).toBe(0)
	expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0)
})

test('Copying a Household invite link says Copied, or shows the link to copy by hand', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto('/settings/profile/household')

	await page.getByRole('button', { name: 'Generate invite link' }).click()
	const copy = page.getByRole('button', { name: 'Copy', exact: true })
	await copy.click()
	await expect(
		page.getByRole('button', { name: 'Copied', exact: true }),
	).toBeVisible()
	const invite = await prisma.householdInvite.findFirstOrThrow({
		where: { householdId: user.householdId },
		select: { token: true },
	})
	const inviteUrl = new URL(
		`/household/join?token=${invite.token}`,
		page.url(),
	).toString()
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(inviteUrl)
	// Click events record an element's text, so the token stays out of them.
	await expect(
		page.getByText(`/household/join?token=${invite.token}`),
	).toHaveClass(/\bph-no-capture\b/)
	// The label goes back after two seconds.
	await expect(copy).toBeVisible({ timeout: 4_000 })

	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, 'writeText', {
			configurable: true,
			value: () => Promise.reject(new Error('Clipboard unavailable')),
		})
	})
	await page.getByRole('button', { name: 'Copy link' }).click()
	const manual = page.getByRole('textbox', { name: 'Invite link' })
	await expect(manual).toHaveValue(inviteUrl)
	await expect(manual).toHaveClass(/\bph-no-capture\b/)
	await expect(manual).toBeFocused()
	expect(
		await manual.evaluate(
			(input: HTMLInputElement) =>
				input.selectionStart === 0 && input.selectionEnd === input.value.length,
		),
	).toBe(true)
	await expect(page.getByRole('button', { name: 'Copied' })).toHaveCount(0)
})

/**
 * Records, from every frame, whether an element matching `selector` ran a CSS
 * transition, into `window[flag]`. Installed before each page load, so it
 * also sees a transition that plays while a page hydrates.
 */
async function recordTransitions(page: Page, selector: string, flag: string) {
	await page.addInitScript(
		({ selector, flag }) => {
			const record = window as unknown as Record<string, boolean>
			record[flag] = false
			const tick = () => {
				for (const element of document.querySelectorAll(selector)) {
					if (
						element
							.getAnimations()
							.some((animation) => animation instanceof CSSTransition)
					) {
						record[flag] = true
					}
				}
				requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		},
		{ selector, flag },
	)
	return {
		reset: () =>
			page.evaluate((flag) => {
				;(window as unknown as Record<string, boolean>)[flag] = false
			}, flag),
		seen: () =>
			page.evaluate(
				(flag) => (window as unknown as Record<string, boolean>)[flag],
				flag,
			),
	}
}

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	test('Keep screen awake is a switch that holds its setting', async ({
		page,
		login,
	}) => {
		await login()
		const thumbSlid = await recordTransitions(
			page,
			'[data-slot="switch-thumb"]',
			'thumbSlid',
		)
		await page.goto('/settings/profile')
		const keepAwake = page.getByRole('switch', {
			name: 'Keep screen awake while a Recipe is open',
		})
		const track = keepAwake.locator('[data-slot="switch-track"]')
		const thumb = keepAwake.locator('[data-slot="switch-thumb"]')
		// How far the thumb sits from the track's left edge.
		const thumbOffset = async () => {
			const [t, k] = await Promise.all([
				track.boundingBox(),
				thumb.boundingBox(),
			])
			return Math.round(k!.x - t!.x)
		}

		// Read from the device after hydration; disabled until then.
		await expect(keepAwake).toBeEnabled()
		await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
		await expectThumbSized(keepAwake)
		await expect(keepAwake).toHaveText('')
		const trackBox = (await track.boundingBox())!
		expect([Math.round(trackBox.width), Math.round(trackBox.height)]).toEqual([
			51, 31,
		])
		expect(await thumbOffset()).toBe(22)

		await keepAwake.tap()
		await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
		expect(
			await page.evaluate(() => localStorage.getItem('qm-keep-awake')),
		).toBe('false')
		// The thumb slides left.
		await expect.poll(thumbOffset).toBe(2)
		expect(await thumbSlid.seen()).toBe(true)

		// A page that opens on Off shows it without playing the slide.
		await page.reload()
		await expect(keepAwake).toBeEnabled()
		await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
		await animationsFinished(page)
		expect(await thumbOffset()).toBe(2)
		expect(await thumbSlid.seen()).toBe(false)

		await keepAwake.tap()
		await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
		expect(
			await page.evaluate(() => localStorage.getItem('qm-keep-awake')),
		).toBe('true')
		await expect.poll(thumbOffset).toBe(22)

		await expectThumbTall(
			page.getByRole('button', { name: 'Delete my account' }),
		)
	})
})
