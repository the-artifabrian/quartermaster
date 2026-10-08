import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { verifyUserPassword } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import { expect, test, createUser, waitFor } from '#tests/playwright-utils.ts'

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
	await page.getByRole('button', { name: 'Delete?' }).click()
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
	await page.getByRole('button', { name: 'Delete?' }).click()
	await expect(page).toHaveURL('/')

	await expect
		.poll(() => prisma.household.count({ where: { id: user.householdId } }))
		.toBe(0)
	expect(await prisma.user.count({ where: { id: user.id } })).toBe(0)
	expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0)
})
