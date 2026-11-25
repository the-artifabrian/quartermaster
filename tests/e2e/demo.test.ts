import { type Page } from '@playwright/test'
import sharp from 'sharp'
import { sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { deleteDemoUser, expireDemoUsers } from '#app/utils/demo.server.ts'
import { DEMO_AI_USES_PER_DAY, DEMO_BLOCKED_MESSAGE } from '#app/utils/demo.ts'
import { SAMPLE_HOUSEHOLD } from '#app/utils/sample-household-data.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { withDemoAiUses } from '#tests/demo-ai-uses.ts'
import { aiCallsFor, newAiCallMarker } from '#tests/mocks/anthropic.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

/**
 * The demo: a visitor gets a user of their own with a copy of the sample
 * Household, which ends after a couple of hours. The e2e database has a demo
 * template (scripts/e2e.sh builds one).
 */

/**
 * The timezone hint the page would set on its first visit, so the copy's
 * sample week is the browser's week, as in a real visit.
 */
async function setTimeZoneHint(page: Page) {
	await page.context().addCookies([
		{
			name: 'CH-time-zone',
			value: encodeURIComponent(
				Intl.DateTimeFormat().resolvedOptions().timeZone,
			),
			domain: 'localhost',
			path: '/',
		},
	])
}

/** The user this browser's session cookie is signed in as, if any. */
async function signedInUserId(page: Page) {
	const cookie = (await page.context().cookies()).find(
		(c) => c.name === 'en_session',
	)
	if (!cookie) return null
	const authSession = await authSessionStorage.getSession(
		`en_session=${cookie.value}`,
	)
	const session = await prisma.session.findUnique({
		where: { id: String(authSession.get(sessionKey)) },
		select: { userId: true },
	})
	return session?.userId ?? null
}

/**
 * Start a demo in this page's browser, as "Try the demo" does, and return
 * the demo user. The test deletes it however it ends.
 */
async function startDemo(page: Page, demoUserIds: string[]) {
	await setTimeZoneHint(page)
	const response = await page.request.post('/demo', { maxRedirects: 0 })
	expect(response.status()).toBe(302)
	expect(response.headers().location).toBe('/recipes')
	const userId = await signedInUserId(page)
	expect(userId).not.toBeNull()
	demoUserIds.push(userId!)
	return prisma.user.findUniqueOrThrow({
		where: { id: userId! },
		select: {
			id: true,
			demoExpiresAt: true,
			householdMembers: { select: { householdId: true } },
		},
	})
}

const demoUserIds: string[] = []

/**
 * Gives the Household a metadata name the AI mock counts calls by
 * (tests/mocks/anthropic.ts), and returns it.
 */
async function countAiCalls(householdId: string) {
	const marker = newAiCallMarker()
	await prisma.recipeMetadataValue.create({
		data: { householdId, dimension: 'cuisine', name: marker, nameKey: marker },
	})
	return marker
}

test.afterEach(async () => {
	for (const userId of demoUserIds.splice(0)) {
		await deleteDemoUser(userId).catch(() => {})
	}
})

test('a demo opens on the sample Recipes and this week’s Plan, and ends signed out when its time is up', async ({
	page,
}) => {
	const visitor = await startDemo(page, demoUserIds)
	const householdId = visitor.householdMembers[0]!.householdId
	expect(visitor.demoExpiresAt).not.toBeNull()
	// The session ends when the demo does.
	const session = await prisma.session.findFirstOrThrow({
		where: { userId: visitor.id },
		select: { expirationDate: true },
	})
	expect(session.expirationDate).toEqual(visitor.demoExpiresAt)

	await page.goto('/recipes')
	const main = page.getByRole('main')
	for (const recipe of SAMPLE_HOUSEHOLD.recipes) {
		await expect(main.getByText(recipe.title, { exact: true })).toBeVisible()
	}

	await page.goto('/plan')
	for (const title of ['Lemon chicken traybake', 'Black bean tacos']) {
		await expect(main.getByRole('heading', { name: title })).toBeVisible()
	}

	// Leave the app first, so no request from the open Plan (its live-update
	// poll) reaches the server after the time moves.
	await page.goto('about:blank')
	// The demo's time runs out. Its session was made to end at the same
	// moment, so both move back.
	const past = new Date(Date.now() - 1000)
	await prisma.user.update({
		where: { id: visitor.id },
		data: { demoExpiresAt: past },
	})
	await prisma.session.updateMany({
		where: { userId: visitor.id },
		data: { expirationDate: past },
	})

	// The server finds the session over and sends the browser home with its
	// cookie cleared.
	await page.goto('/plan')
	await expect(page).toHaveURL('/')
	await expect(
		page.getByRole('link', { name: 'Log in', exact: true }).first(),
	).toBeVisible()
	expect(await signedInUserId(page)).toBeNull()

	await expireDemoUsers({
		onFailure: (userId, error) => {
			throw new Error(`Couldn't expire ${userId}: ${String(error)}`)
		},
	})
	expect(await prisma.user.count({ where: { id: visitor.id } })).toBe(0)
	expect(await prisma.household.count({ where: { id: householdId } })).toBe(0)
})

// Other tests make demo users with createDemoCopy. This one starts from the
// homepage button, the way a visitor does, so the guard meets that demo too.
test('a demo started from the homepage can’t rename its Household, and says so', async ({
	page,
}) => {
	await page.goto('/')
	await hydrated(page.getByRole('button', { name: 'Try the demo' }))
	await page.getByRole('button', { name: 'Try the demo' }).click()
	await expect(page).toHaveURL(/\/recipes/)
	const userId = await signedInUserId(page)
	expect(userId).not.toBeNull()
	demoUserIds.push(userId!)
	const { householdId, household } =
		await prisma.householdMember.findFirstOrThrow({
			where: { userId: userId! },
			select: { householdId: true, household: { select: { name: true } } },
		})

	await page.goto('/settings/profile/household')
	await hydrated(page.getByRole('button', { name: 'Rename', exact: true }))
	// The member row reads as a person, not the demo's made-up username.
	const member = page.getByRole('listitem').filter({ hasText: 'Guest (you)' })
	await expect(member).toHaveText(/^Guest \(you\)owner$/)
	await expect(page.getByText(/@demo-/)).toHaveCount(0)

	await page.getByLabel('Household name').fill('Renamed in the demo')
	await page.getByRole('button', { name: 'Rename', exact: true }).click()

	await expect(page.getByText(DEMO_BLOCKED_MESSAGE)).toBeVisible()
	await expect(page).toHaveURL('/settings/profile/household')
	expect(
		await prisma.household.findUniqueOrThrow({
			where: { id: householdId },
			select: { name: true },
		}),
	).toEqual(household)
})

test('once the demo’s shared AI uses for the day are gone, an AI import says so and calls nothing', async ({
	page,
}) => {
	// Waits for other tests that use the shared count (e2e-lock.ts).
	test.slow()
	const visitor = await startDemo(page, demoUserIds)
	const householdId = visitor.householdMembers[0]!.householdId
	const aiCalls = await countAiCalls(householdId)
	const screenshot = await sharp({
		create: { width: 60, height: 40, channels: 3, background: '#f4efe6' },
	})
		.png()
		.toBuffer()

	await withDemoAiUses(async () => {
		// A full day's worth; withDemoAiUses started the count from zero.
		const seeded = await prisma.demoAiUsage.createManyAndReturn({
			data: Array.from({ length: DEMO_AI_USES_PER_DAY }, () => ({
				type: 'recipe_extract_llm_call',
			})),
			select: { id: true },
		})
		const recipesBefore = await prisma.recipe.count({ where: { householdId } })
		try {
			await page.goto('/recipes/import')
			await expect(page.locator('html')).toHaveAttribute('data-hydrated')
			await page.getByRole('tab', { name: 'From image', exact: true }).click()
			await page.getByLabel('Upload screenshots (up to 5)').setInputFiles({
				name: 'recipe.png',
				mimeType: 'image/png',
				buffer: screenshot,
			})
			await page.getByRole('button', { name: 'Read with AI' }).click()

			await expect(
				page.getByText(
					"The demo's AI is used up for today. Try again tomorrow, or sign up.",
				),
			).toBeVisible()
			await expect(page).toHaveURL(/\/recipes\/import/)
			// The use is refused before the AI is asked: no call, nothing
			// counted, nothing saved.
			expect(await aiCallsFor(aiCalls)).toBe(0)
			expect(
				await prisma.usageEvent.count({ where: { userId: visitor.id } }),
			).toBe(0)
			expect(await prisma.recipe.count({ where: { householdId } })).toBe(
				recipesBefore,
			)
		} finally {
			await prisma.demoAiUsage.deleteMany({
				where: { id: { in: seeded.map((row) => row.id) } },
			})
		}
	})
})

test('a real member whose username starts with demo still shows it', async ({
	page,
	login,
}) => {
	const user = await login({
		username: `demo_${Math.random().toString(36).slice(2, 8)}`,
	})
	await page.goto('/settings/profile/household')
	await expect(page.getByText(`@${user.username} · owner`)).toBeVisible()
})
