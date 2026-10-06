import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

test('a household with no Staples adds the first ones from the suggestions', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/inventory')

	await expect(
		page.getByRole('heading', { name: 'No Staples yet' }),
	).toBeVisible()
	const suggestions = page.getByRole('list', { name: 'Suggested Staples' })
	await suggestions.getByRole('button', { name: 'Add Olive oil' }).click()

	const staples = page.getByRole('list', { name: 'Staples' })
	await expect(staples.getByText('Olive oil')).toBeVisible()
	await expect(
		suggestions.getByRole('button', { name: 'Add Olive oil' }),
	).toHaveCount(0)
	await expect(
		page.getByRole('heading', { name: 'Others you might keep' }),
	).toBeVisible()
	await suggestions.getByRole('button', { name: 'Add Garlic' }).click()
	await expect(staples.getByText('Garlic')).toBeVisible()

	await expect
		.poll(() =>
			prisma.householdIngredient.findMany({
				where: { householdId: user.householdId, isStaple: true },
				select: { displayName: true },
				orderBy: { displayName: 'asc' },
			}),
		)
		.toEqual([{ displayName: 'Garlic' }, { displayName: 'Olive oil' }])

	// A later visit with Staples present shows no suggestions.
	await page.goto('/inventory')
	await expect(staples.getByText('Garlic')).toBeVisible()
	await expect(
		page.getByRole('list', { name: 'Suggested Staples' }),
	).toHaveCount(0)
})
