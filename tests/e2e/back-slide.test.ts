import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// Phone in the iOS app, where pages slide (nav-direction.ts).
test.use({
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true,
	userAgent: SHELL_UA,
})

type Slide = { direction: string; ms: number }

// Records each view transition: the slide direction once its update has run
// (the navigation sets it there) and how long it stayed on screen.
async function recordTransitions(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { __slides: Array<Slide> }
		type Slide = { direction: string; ms: number }
		w.__slides = []
		const start = document.startViewTransition?.bind(document)
		if (!start) return
		document.startViewTransition = ((update?: ViewTransitionUpdateCallback) => {
			const transition = start(update)
			const began = performance.now()
			let direction = '-'
			void transition.updateCallbackDone.then(
				() => {
					direction = document.documentElement.dataset.navDirection ?? '-'
				},
				() => {},
			)
			void transition.finished.finally(() => {
				w.__slides.push({ direction, ms: performance.now() - began })
			})
			return transition
		}) as typeof document.startViewTransition
	})
}

function takeSlides(page: Page) {
	return page.evaluate(() => {
		const w = window as unknown as { __slides: Array<Slide> }
		return w.__slides.splice(0)
	})
}

function slidesThatMoved(slides: Array<Slide>) {
	return slides.filter(
		(s) => s.direction === 'forward' || s.direction === 'back',
	)
}

test('Back from a Recipe plays one whole slide while the list loads fresh data behind it', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: user.householdId,
			ingredients: { create: { name: 'miso', amount: '2', order: 0 } },
			instructions: { create: { content: 'Stir.', order: 0 } },
		},
	})
	await recordTransitions(page)
	await page.goto('/recipes')
	await expect(page.getByRole('link', { name: /Miso Soup/ })).toBeVisible()
	// Hydrated: the card's tap is the router's, with its slide.
	await page.waitForLoadState('networkidle')

	await page
		.getByRole('link', { name: /Miso Soup/ })
		.first()
		.tap()
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`))
	await expect(
		page.getByRole('heading', { level: 1, name: 'Miso Soup' }),
	).toBeVisible()
	await expect
		.poll(async () => slidesThatMoved(await takeSlides(page)).length)
		.toBe(1)

	// Renamed elsewhere: the list's stored copy is stale, so it revalidates on
	// the way back.
	await prisma.recipe.update({
		where: { id: recipe.id },
		data: { title: 'Red Miso Soup' },
	})
	await page.getByRole('link', { name: 'Back to Recipes' }).tap()
	await expect(page).toHaveURL(/\/recipes$/)
	await expect(page.getByRole('link', { name: /Red Miso Soup/ })).toBeVisible()
	// Long enough for the slide and any transition after it.
	await page.waitForTimeout(1000)
	const back = slidesThatMoved(await takeSlides(page))
	expect(back).toHaveLength(1)
	expect(back[0]!.direction).toBe('back')
	// Not cut short (the slide is 320ms).
	expect(back[0]!.ms).toBeGreaterThan(250)

	// Opening the Recipe again shows its stored copy, which revalidates during
	// the forward slide.
	await page
		.getByRole('link', { name: /Red Miso Soup/ })
		.first()
		.tap()
	await expect(
		page.getByRole('heading', { level: 1, name: 'Red Miso Soup' }),
	).toBeVisible()
	await page.waitForTimeout(1000)
	const forward = slidesThatMoved(await takeSlides(page))
	expect(forward).toHaveLength(1)
	expect(forward[0]!.direction).toBe('forward')
	expect(forward[0]!.ms).toBeGreaterThan(250)
})
