import { prisma } from '#app/utils/db.server.ts'
import { createUser, expect, test } from '#tests/playwright-utils.ts'

test('an owner who joins another Household leaves the other member in charge', async ({
	page,
	login,
}) => {
	const owner = await login()
	const [member, host] = await Promise.all(
		['Remaining member', 'Host'].map((name) =>
			prisma.user.create({
				data: { ...createUser(), name },
				select: { id: true, username: true },
			}),
		),
	)
	await prisma.householdMember.create({
		data: {
			householdId: owner.householdId,
			userId: member!.id,
			role: 'member',
		},
	})
	const elsewhere = await prisma.household.create({
		data: {
			name: 'The Hosts',
			members: { create: { userId: host!.id, role: 'owner' } },
		},
		select: { id: true },
	})
	try {
		const invite = await prisma.householdInvite.create({
			data: {
				token: crypto.randomUUID(),
				expiresAt: new Date(Date.now() + 86_400_000),
				householdId: elsewhere.id,
				createdById: host!.id,
			},
			select: { token: true },
		})

		await page.goto(`/household/join?token=${invite.token}`)
		await expect(page.getByText('The Hosts')).toBeVisible()
		await page.getByRole('button', { name: 'Accept' }).click()
		await expect(page).toHaveURL('/recipes')
		await expect(page.getByText('Joined household!')).toBeVisible()

		expect(
			await prisma.householdMember.findMany({
				where: { userId: { in: [owner.id, member!.id] } },
				select: { userId: true, householdId: true, role: true },
				orderBy: { role: 'asc' },
			}),
		).toEqual([
			{ userId: owner.id, householdId: elsewhere.id, role: 'member' },
			{ userId: member!.id, householdId: owner.householdId, role: 'owner' },
		])

		// The member left behind now runs the Household.
		await page.context().clearCookies()
		await login({ id: member!.id })
		await page.goto('/settings/profile/household')
		await expect(
			page.getByRole('textbox', { name: 'Household name' }),
		).toBeVisible()
		await expect(
			page.getByRole('button', { name: 'Generate invite link' }),
		).toBeVisible()
		await expect(page.getByText(`@${member!.username} · owner`)).toBeVisible()
		await expect(
			page.getByRole('button', { name: 'Leave household' }),
		).toHaveCount(0)
	} finally {
		await prisma.household.delete({ where: { id: elsewhere.id } })
		await prisma.user.deleteMany({
			where: { id: { in: [member!.id, host!.id] } },
		})
	}
})
