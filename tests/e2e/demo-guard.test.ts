/**
 * What a demo user sees when they reach something the demo turns off. Demo
 * users are made with createDemoCopy, the way the entry route makes them, and
 * signed in the way other fixtures sign users in.
 */
import sharp from 'sharp'
import { deleteAccount } from '#app/utils/account-deletion.server.ts'
import { serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createDemoCopy } from '#app/utils/demo.server.ts'
import { DEMO_BLOCKED_MESSAGE } from '#app/utils/demo.ts'
import { browserToday, expect, test } from '#tests/playwright-utils.ts'

const demoTest = test.extend<{
	demo: { userId: string; householdId: string }
}>({
	demo: async ({ login }, use) => {
		const copy = await createDemoCopy(prisma, {
			today: serializeDate(browserToday()),
		})
		expect(copy).toMatchObject({ ok: true })
		if (!copy.ok) throw new Error(`No demo copy: ${copy.reason}`)
		try {
			await login({ id: copy.userId })
			await use(copy)
		} finally {
			// The way expiry removes a demo user, which keeps the template's
			// photos for the other copies.
			await deleteAccount(copy.userId)
		}
	},
})

demoTest(
	'renaming the Household says it is turned off in the demo, and keeps the name',
	async ({ page, demo }) => {
		const before = await prisma.household.findUniqueOrThrow({
			where: { id: demo.householdId },
			select: { name: true },
		})

		await page.goto('/settings/profile/household')
		await expect(page.locator('html')).toHaveAttribute('data-hydrated')
		await page.getByLabel('Household name').fill('Renamed in the demo')
		await page.getByRole('button', { name: 'Rename', exact: true }).click()

		await expect(page.getByText(DEMO_BLOCKED_MESSAGE)).toBeVisible()
		await expect(page).toHaveURL('/settings/profile/household')
		expect(
			await prisma.household.findUniqueOrThrow({
				where: { id: demo.householdId },
				select: { name: true },
			}),
		).toEqual(before)
	},
)

demoTest(
	"a demo Recipe's share page is not found, and Share says why",
	async ({ page, browser, demo }) => {
		const recipe = await prisma.recipe.findFirstOrThrow({
			where: { householdId: demo.householdId },
			select: { id: true, title: true },
		})

		const visitor = await browser.newContext()
		try {
			const response = await (
				await visitor.newPage()
			).goto(`/share/${recipe.id}`)
			expect(response?.status()).toBe(404)
		} finally {
			await visitor.close()
		}

		await page.goto(`/recipes/${recipe.id}`)
		await expect(page.locator('html')).toHaveAttribute('data-hydrated')
		await page.getByRole('button', { name: 'Share', exact: true }).click()
		await expect(page.getByText(DEMO_BLOCKED_MESSAGE)).toBeVisible()
	},
)

demoTest(
	'after three AI imports the import screen says what the demo allows',
	async ({ page, demo }) => {
		// Two of the demo's three imports are already spent.
		await prisma.usageEvent.createMany({
			data: [0, 1].map(() => ({
				type: 'recipe_extract_llm_call',
				userId: demo.userId,
			})),
		})
		const screenshot = await sharp({
			create: { width: 60, height: 40, channels: 3, background: '#f4efe6' },
		})
			.png()
			.toBuffer()
		// A screenshot import, which the e2e AI mock answers with a Recipe.
		const extract = async () => {
			await page.goto('/recipes/import')
			await expect(page.locator('html')).toHaveAttribute('data-hydrated')
			await page.getByRole('tab', { name: 'From Image', exact: true }).click()
			await page.getByLabel('Upload screenshots (up to 5)').setInputFiles({
				name: 'recipe.png',
				mimeType: 'image/png',
				buffer: screenshot,
			})
			await page.getByRole('button', { name: 'Extract with AI' }).click()
		}

		await extract()
		await expect(page).toHaveURL(/\/recipes\/(?!import)[^/?]+/)

		await extract()
		await expect(
			page.getByText(
				'The demo allows 3 AI imports. Sign up to keep importing.',
			),
		).toBeVisible()
		await expect(page).toHaveURL(/\/recipes\/import/)
		expect(
			await prisma.usageEvent.count({
				where: { userId: demo.userId, type: 'recipe_extract_llm_call' },
			}),
		).toBe(3)
	},
)

demoTest(
	'a photo picked on the edit screen is left out, and the save says so',
	async ({ page, demo }) => {
		const recipe = await prisma.recipe.findFirstOrThrow({
			where: { householdId: demo.householdId, image: { isNot: null } },
			select: { id: true, image: { select: { objectKey: true } } },
		})
		const photo = await sharp({
			create: { width: 40, height: 30, channels: 3, background: '#c86b3c' },
		})
			.jpeg()
			.toBuffer()

		await page.goto(`/recipes/${recipe.id}/edit`)
		await expect(page.locator('html')).toHaveAttribute('data-hydrated')
		await page.getByText('Photo', { exact: true }).click()
		await page.locator('input[type="file"][name="image"]').setInputFiles({
			name: 'IMG_0002.JPG',
			mimeType: 'image/jpeg',
			buffer: photo,
		})
		await page.getByRole('button', { name: 'Save', exact: true }).click()

		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await expect(
			page.getByText(
				'Saved without the photo. Photos are turned off in the demo.',
			),
		).toBeVisible()
		expect(
			await prisma.recipeImage.findUnique({
				where: { recipeId: recipe.id },
				select: { objectKey: true },
			}),
		).toEqual(recipe.image)
	},
)
