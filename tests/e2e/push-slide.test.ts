import { type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

// In the iOS app every push into a page with a nav bar slides in from the
// right, and the nav bar's Back, Cancel, and an edit screen's leave after
// Save or Delete slide back, once per navigation. Taps that change something
// tick the haptic the iOS control would.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

type User = { id: string; householdId: string }

type Transition = {
	/** `data-nav-direction` once the new page has rendered. */
	direction: string | null
	/** The animation the new page's snapshot runs. */
	animation: string | null
	finished: boolean
	/** Sheets, menus and sheet copies on screen as the leaving page's picture
	 * is taken, and once the new page has rendered. */
	overlaysAtStart: number
	overlaysAfterUpdate: number
	/** Inert copies of a sheet playing its exit, once the new page rendered. */
	sheetCopies: number
}

/**
 * Records each view transition, and the haptics and other messages the page
 * posts to the iOS app's handlers.
 */
async function instrument(page: Page) {
	await page.addInitScript(() => {
		const messages: string[] = []
		const handler = (name: string) => ({
			postMessage: (message: string) => messages.push(`${name}:${message}`),
		})
		const transitions: Array<{
			direction: string | null
			animation: string | null
			finished: boolean
			overlaysAtStart: number
			overlaysAfterUpdate: number
			sheetCopies: number
		}> = []
		const overlaysShown = () =>
			[
				...document.querySelectorAll(
					'[role=dialog], [role=menu], [data-bottom-sheet]',
				),
			].filter((overlay) =>
				overlay.checkVisibility({ visibilityProperty: true }),
			).length
		Object.assign(window, {
			__bridgeMessages: messages,
			__transitions: transitions,
			webkit: {
				messageHandlers: {
					haptic: handler('haptic'),
					theme: handler('theme'),
					refresh: handler('refresh'),
					launch: handler('launch'),
				},
			},
		})
		const start = document.startViewTransition.bind(document)
		document.startViewTransition = ((
			...args: Parameters<typeof document.startViewTransition>
		) => {
			const overlaysAtStart = overlaysShown()
			const transition = start(...args)
			const record = {
				direction: null as string | null,
				animation: null as string | null,
				finished: false,
				overlaysAtStart,
				overlaysAfterUpdate: 0,
				sheetCopies: 0,
			}
			transitions.push(record)
			transition.updateCallbackDone.then(
				() => {
					record.direction =
						document.documentElement.dataset.navDirection ?? null
					record.overlaysAfterUpdate = overlaysShown()
					record.sheetCopies = document.querySelectorAll(
						'[data-bottom-sheet][inert]',
					).length
				},
				() => {},
			)
			transition.ready.then(
				() => {
					const animation = document
						.getAnimations()
						.find(
							(a) =>
								(a.effect as KeyframeEffect | null)?.pseudoElement ===
								'::view-transition-new(root)',
						)
					record.animation =
						(animation as CSSAnimation | undefined)?.animationName ?? null
				},
				() => {},
			)
			transition.finished.finally(() => {
				record.finished = true
			})
			return transition
		}) as typeof document.startViewTransition
	})

	// Loads of route data in flight, and when the last one settled.
	let pending = 0
	let lastSettled = Date.now()
	const isData = (url: string) => new URL(url).pathname.endsWith('.data')
	page.on('request', (request) => {
		if (isData(request.url())) pending++
	})
	const settle = (request: { url(): string }) => {
		if (!isData(request.url())) return
		pending--
		lastSettled = Date.now()
	}
	page.on('requestfinished', settle)
	page.on('requestfailed', settle)

	const transitions = () =>
		page.evaluate(
			() =>
				(window as unknown as { __transitions: Transition[] }).__transitions,
		)
	const messages = () =>
		page.evaluate(
			() =>
				(window as unknown as { __bridgeMessages: string[] }).__bridgeMessages,
		)
	const haptics = async () =>
		(await messages())
			.filter((m) => m.startsWith('haptic:'))
			.map((m) => m.slice('haptic:'.length))

	/**
	 * Every transition has run, and no route data has loaded for a while: a
	 * revalidation of the page landed on has come and gone.
	 */
	async function settled() {
		await expect
			.poll(async () => {
				const all = await transitions()
				return (
					all.every((t) => t.finished) &&
					pending === 0 &&
					Date.now() - lastSettled > 500
				)
			})
			.toBe(true)
	}

	/**
	 * `act` navigates with exactly one view transition that moves, sliding
	 * `direction`. The router may start another for the landed page's
	 * revalidation (it treats one as a POP); that one must move nothing.
	 */
	async function expectSlide(
		direction: 'forward' | 'back',
		act: () => Promise<unknown>,
	) {
		const before = (await transitions()).length
		await act()
		await expect
			.poll(async () => (await transitions()).length)
			.toBeGreaterThan(before)
		await settled()
		const started = (await transitions()).slice(before)
		const moved = started.filter((t) => t.animation !== null)
		expect(moved).toHaveLength(1)
		expect(started[0]).toBe(moved[0])
		for (const after of started.slice(1)) {
			expect(after).toMatchObject({ direction: 'none', animation: null })
		}
		expect(started[0]).toMatchObject({
			direction,
			animation:
				direction === 'forward'
					? 'page-enter-from-right'
					: 'page-return-from-left',
		})
		return started[0]!
	}

	/**
	 * `act` starts no view transition by the time `landed` holds (the URL it
	 * goes to has committed, or what it opens shows) and all has settled.
	 */
	async function expectNoTransition(
		act: () => Promise<unknown>,
		landed: () => Promise<unknown>,
	) {
		const before = (await transitions()).length
		await act()
		await landed()
		await settled()
		expect((await transitions()).slice(before)).toEqual([])
	}

	/** The haptics `act` taps, in order. */
	async function hapticsOf(act: () => Promise<unknown>, settle = true) {
		const before = (await haptics()).length
		await act()
		if (settle) await settled()
		return (await haptics()).slice(before)
	}

	return {
		transitions,
		messages,
		haptics,
		settled,
		expectSlide,
		expectNoTransition,
		hapticsOf,
	}
}

const navBar = (page: Page) => page.locator('[data-nav-bar]')
const backButton = (page: Page, label: string) =>
	navBar(page).getByRole('link', { name: `Back to ${label}` })
const saveButton = (page: Page) => page.locator('[data-nav-save]')
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const heading = (page: Page, name: string) =>
	page.getByRole('heading', { level: 1, name })

async function createRecipe(
	user: User,
	title: string,
	extra: { linkedRecipeId?: string } = {},
) {
	return prisma.recipe.create({
		data: {
			title,
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'lentils', order: 0 },
					...(extra.linkedRecipeId
						? [
								{
									name: 'vegetable stock',
									order: 1,
									linkedRecipeId: extra.linkedRecipeId,
								},
							]
						: []),
				],
			},
			instructions: {
				create: [
					{ content: 'Rinse the lentils.', order: 0 },
					{ content: 'Simmer until soft.', order: 1 },
				],
			},
		},
		include: { instructions: { orderBy: { order: 'asc' } } },
	})
}

function todayUTC() {
	const today = new Date()
	return new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
}

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('a Recipe, a linked Recipe and Edit slide in; Back and Save slide back', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const stock = await createRecipe(user, 'Vegetable stock')
		const soup = await createRecipe(user, 'Lentil soup', {
			linkedRecipeId: stock.id,
		})

		await page.goto('/recipes')
		const card = page.getByRole('link', { name: 'Lentil soup recipe' })
		await hydrated(card)
		await ui.settled()
		expect(await ui.haptics()).toEqual([])

		await ui.expectSlide('forward', () => card.tap())
		await expect(heading(page, 'Lentil soup')).toBeVisible()

		const linked = page
			.locator('main')
			.getByRole('link', { name: 'vegetable stock', exact: true })
		await ui.expectSlide('forward', () => linked.tap())
		await expect(page).toHaveURL(`/recipes/${stock.id}`)
		await expect(heading(page, 'Vegetable stock')).toBeVisible()

		await ui.expectSlide('back', () => backButton(page, 'Recipe').tap())
		await expect(page).toHaveURL(`/recipes/${soup.id}`)

		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Edit Recipe' }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/${soup.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Red lentil soup')
		const saveHaptics = await ui.hapticsOf(() =>
			ui.expectSlide('back', () => saveButton(page).tap()),
		)
		await expect(page).toHaveURL(`/recipes/${soup.id}`)
		await expect(heading(page, 'Red lentil soup')).toBeVisible()
		expect(saveHaptics).toEqual(['success'])
		expect(
			(await prisma.recipe.findUniqueOrThrow({ where: { id: soup.id } })).title,
		).toBe('Red lentil soup')

		await ui.expectSlide('back', () => backButton(page, 'Recipes').tap())
		await expect(page).toHaveURL('/recipes')

		// Cancel slides back too.
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Red lentil soup recipe' }).tap(),
		)
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Edit Recipe' }).tap(),
		)
		await ui.expectSlide('back', () =>
			navBar(page).getByRole('link', { name: 'Cancel' }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/${soup.id}`)

		// A tab switch starts none.
		await ui.expectNoTransition(
			() => tabBar(page).getByRole('link', { name: 'Plan', exact: true }).tap(),
			() => expect(page).toHaveURL(/\/plan/),
		)
	})

	test('Write a Recipe and Import slide in from the Recipes menu; a new Recipe slides back once saved', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		await createRecipe(user, 'Lentil soup')
		await page.goto('/recipes')
		const add = page.getByRole('button', { name: 'New Recipe' })
		await hydrated(add)

		// The menu goes as the push begins: it does not slide away with the
		// page.
		await add.tap()
		await expect(page.getByRole('menu')).toBeVisible()
		expect(
			await ui.expectSlide('forward', () =>
				page.getByRole('menuitem', { name: 'Import' }).tap(),
			),
		).toMatchObject({ overlaysAtStart: 0, overlaysAfterUpdate: 0 })
		await expect(page).toHaveURL('/recipes/import')
		await ui.expectSlide('back', () => backButton(page, 'Recipes').tap())

		await add.tap()
		await expect(page.getByRole('menu')).toBeVisible()
		expect(
			await ui.expectSlide('forward', () =>
				page.getByRole('menuitem', { name: 'Write a Recipe' }).tap(),
			),
		).toMatchObject({ overlaysAtStart: 0, overlaysAfterUpdate: 0 })
		await expect(page).toHaveURL('/recipes/new')
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Bean stew')
		await page.getByLabel('Ingredient 1 name').fill('beans')
		await page.getByLabel('Step 1', { exact: true }).fill('Simmer.')
		const saveHaptics = await ui.hapticsOf(() =>
			ui.expectSlide('back', () => saveButton(page).tap()),
		)
		expect(saveHaptics).toEqual(['success'])
		await expect(heading(page, 'Bean stew')).toBeVisible()
		const created = await prisma.recipe.findFirstOrThrow({
			where: { householdId: user.householdId, title: 'Bean stew' },
		})
		await expect(page).toHaveURL(`/recipes/${created.id}`)

		// The new Recipe took the form's place.
		await ui.expectSlide('back', () => backButton(page, 'Recipes').tap())
		await expect(page).toHaveURL('/recipes')
	})

	test("the empty Recipes page's links slide in", async ({ page, login }) => {
		const ui = await instrument(page)
		await login()
		await page.goto('/recipes')
		const main = page.locator('main')
		const write = main.getByRole('link', { name: 'Write a Recipe' })
		await hydrated(write)

		await ui.expectSlide('forward', () => write.tap())
		await expect(page).toHaveURL('/recipes/new')
		await ui.expectSlide('back', () =>
			navBar(page).getByRole('link', { name: 'Cancel' }).tap(),
		)
		await expect(page).toHaveURL('/recipes')

		await ui.expectSlide('forward', () =>
			main.getByRole('link', { name: 'Import', exact: true }).tap(),
		)
		await expect(page).toHaveURL('/recipes/import')
	})

	test('New Menu, Edit and a Menu’s Recipe slide in; a new Menu slides back once saved', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const soup = await createRecipe(user, 'Lentil soup')
		const menu = await prisma.menu.create({
			data: {
				title: 'Soup night',
				titleKey: 'soup night',
				householdId: user.householdId,
				sections: {
					create: {
						order: 0,
						items: {
							create: {
								kind: 'recipe',
								recipeId: soup.id,
								recipeTitle: soup.title,
								order: 0,
							},
						},
					},
				},
			},
		})

		await page.goto('/recipes/menus')
		// On a phone the title's + shows no words; its name is its label.
		const newMenu = page
			.getByRole('main')
			.getByRole('link', { name: 'New Menu', exact: true })
		await hydrated(newMenu)
		await ui.expectSlide('forward', () => newMenu.tap())
		await expect(page).toHaveURL('/recipes/menus/new')
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Picnic')
		const saveHaptics = await ui.hapticsOf(() =>
			ui.expectSlide('back', () => saveButton(page).tap()),
		)
		expect(saveHaptics).toEqual(['success'])
		const created = await prisma.menu.findFirstOrThrow({
			where: { householdId: user.householdId, title: 'Picnic' },
		})
		await expect(page).toHaveURL(`/recipes/menus/${created.id}`)
		await ui.expectSlide('back', () => backButton(page, 'Menus').tap())
		await expect(page).toHaveURL('/recipes/menus')

		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: /Soup night/ }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Edit', exact: true }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}/edit`)
		await ui.expectSlide('back', () =>
			navBar(page).getByRole('link', { name: 'Cancel' }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)

		await ui.expectSlide('forward', () =>
			page
				.locator('main')
				.getByRole('link', { name: /Lentil soup/ })
				.tap(),
		)
		await expect(page).toHaveURL(`/recipes/${soup.id}`)
		await ui.expectSlide('back', () => backButton(page, 'Menu').tap())
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
	})

	test('a planned Recipe, its Menu, and New Recipe in the Add Recipe sheet slide in from the Plan', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const soup = await createRecipe(user, 'Lentil soup')
		const menu = await prisma.menu.create({
			data: {
				title: 'Soup night',
				titleKey: 'soup night',
				householdId: user.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})
		const today = todayUTC()
		const weekStart = getWeekStart(today)
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart,
				meals: {
					create: {
						date: today,
						order: 0,
						sourceMenuId: menu.id,
						recipeItems: {
							create: { recipeId: soup.id, recipeTitle: soup.title, order: 0 },
						},
					},
				},
			},
		})
		const planUrl = `/plan?weekStart=${serializeDate(weekStart)}`
		await page.goto(planUrl)
		const plan = page.getByTestId('mobile-plan')
		const recipeLink = plan.getByRole('link', {
			name: 'Lentil soup',
			exact: true,
		})
		await hydrated(recipeLink)

		await ui.expectSlide('forward', () => recipeLink.tap())
		await expect(page).toHaveURL(`/recipes/${soup.id}`)
		await ui.expectSlide('back', () => backButton(page, 'Plan').tap())

		await ui.expectSlide('forward', () =>
			plan.getByRole('link', { name: 'Soup night' }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
		await ui.expectSlide('back', () => backButton(page, 'Plan').tap())

		// Every Recipe is on the Meal already, so the picker offers a new one.
		await plan.getByRole('button', { name: /^Add Recipe to / }).tap()
		const sheet = page.getByRole('dialog')
		const newRecipe = sheet.getByRole('link', { name: 'New Recipe' })
		await expect(newRecipe).toBeVisible()
		// The sheet goes as the push begins: it is not in the Plan's picture,
		// and no copy of it slides down over the new page.
		expect(
			await ui.expectSlide('forward', () => newRecipe.tap()),
		).toMatchObject({
			overlaysAtStart: 0,
			overlaysAfterUpdate: 0,
			sheetCopies: 0,
		})
		await expect(page).toHaveURL('/recipes/new')
		await expect(page.locator('[data-bottom-sheet]')).toHaveCount(0)
	})

	test('Settings and its pages slide in from the avatar', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		await login()
		await page.goto('/plan')
		const avatar = page.getByRole('link', { name: 'Settings' })
		await hydrated(avatar)

		await ui.expectSlide('forward', () => avatar.tap())
		await expect(page).toHaveURL('/settings/profile')
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Household' }).tap(),
		)
		await expect(page).toHaveURL('/settings/profile/household')
		await expect(navBar(page)).toBeVisible()
		await ui.expectSlide('back', () => backButton(page, 'Settings').tap())
		await expect(page).toHaveURL('/settings/profile')

		// A password page leaves by the nav bar's Back only.
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: /^(Create )?Password$/ }).tap(),
		)
		await expect(page).toHaveURL(/\/settings\/profile\/password/)
		await expect(
			page.locator('main').getByRole('link', { name: 'Cancel' }),
		).toHaveCount(0)
		await ui.expectSlide('back', () => backButton(page, 'Settings').tap())
		await expect(page).toHaveURL('/settings/profile')

		await ui.expectSlide('back', () => backButton(page, 'Plan').tap())
		await expect(page).toHaveURL('/plan')

		// Tab switches start none.
		await ui.expectNoTransition(
			() =>
				tabBar(page).getByRole('link', { name: 'Shopping', exact: true }).tap(),
			() => expect(page).toHaveURL('/shopping'),
		)
	})

	test("the import notice's links and Import's Open it slide in", async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const older = await createRecipe(user, 'Chickpea lunch')
		await prisma.recipe.update({
			where: { id: older.id },
			data: { sourceUrl: 'https://example.com/chickpea-lunch' },
		})

		await page.goto('/recipes')
		await page.goto('/recipes/import')
		await page.getByRole('tab', { name: 'From text', exact: true }).tap()
		await page
			.getByLabel('Recipe text', { exact: true })
			.fill(
				'Chickpea lunch\nIngredients\n1 lemon\nInstructions\nSqueeze the lemon.',
			)
		await page
			.getByRole('button', { name: 'Read as written', exact: true })
			.tap()
		const notice = page.getByRole('region', { name: 'Saved to your Recipes' })
		await expect(notice).toBeVisible()
		await ui.settled()
		const saved = await prisma.recipe.findFirstOrThrow({
			where: { householdId: user.householdId, id: { not: older.id } },
		})

		await ui.expectSlide('forward', () =>
			notice.getByRole('link', { name: 'Edit', exact: true }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/${saved.id}/edit`)
		await ui.expectSlide('back', () =>
			navBar(page).getByRole('link', { name: 'Cancel' }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/${saved.id}`)

		await page.goto(`/recipes/${saved.id}?imported=text`)
		await expect(notice).toBeVisible()
		await hydrated(notice.getByRole('link', { name: 'Open it' }))
		await ui.settled()
		await ui.expectSlide('forward', () =>
			notice.getByRole('link', { name: 'Open it' }).tap(),
		)
		await expect(page).toHaveURL(`/recipes/${older.id}`)

		await page.goto(`/recipes/${saved.id}?imported=text`)
		const another = notice.getByRole('link', { name: 'Import another' })
		await hydrated(another)
		await ui.settled()
		await ui.expectSlide('forward', () => another.tap())
		await expect(page).toHaveURL('/recipes/import')

		await page.goto(
			`/recipes/import?url=${encodeURIComponent('https://example.com/chickpea-lunch')}`,
		)
		await expect(page.getByText('Already in your Recipes')).toBeVisible()
		const openIt = page.getByRole('link', { name: 'Open it', exact: true })
		await hydrated(openIt)
		await ui.settled()
		await ui.expectSlide('forward', () => openIt.tap())
		await expect(page).toHaveURL(`/recipes/${older.id}`)
	})

	test('Discard Changes slides back, after Cancel and after a history back', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const soup = await createRecipe(user, 'Lentil soup')
		const discard = () =>
			page
				.getByRole('dialog', { name: 'Discard changes?' })
				.getByRole('button', { name: 'Discard Changes' })
				.tap()
		await page.goto('/recipes')
		const card = page.getByRole('link', { name: 'Lentil soup recipe' })
		await hydrated(card)
		await ui.expectSlide('forward', () => card.tap())

		for (const leave of [
			() => navBar(page).getByRole('link', { name: 'Cancel' }).tap(),
			() => page.evaluate(() => window.history.back()),
		]) {
			await ui.expectSlide('forward', () =>
				page.getByRole('link', { name: 'Edit Recipe' }).tap(),
			)
			await hydrated(saveButton(page))
			await page.getByLabel('Title').fill('Something else')
			await ui.expectNoTransition(leave, () =>
				expect(
					page.getByRole('dialog', { name: 'Discard changes?' }),
				).toBeVisible(),
			)
			await ui.expectSlide('back', discard)
			await expect(page).toHaveURL(`/recipes/${soup.id}`)
			await expect(heading(page, 'Lentil soup')).toBeVisible()
		}
		expect(
			(await prisma.recipe.findUniqueOrThrow({ where: { id: soup.id } })).title,
		).toBe('Lentil soup')
	})

	test('a sheet reopened while a push from it is still loading shows, and works on the landed Recipe', async ({
		page,
		login,
	}) => {
		await instrument(page)
		const user = await login()
		const longRecipe = (title: string, linkedRecipeId?: string) =>
			prisma.recipe.create({
				data: {
					title,
					userId: user.id,
					householdId: user.householdId,
					ingredients: {
						create: Array.from({ length: 20 }, (_, order) => ({
							name: order === 0 && linkedRecipeId ? 'stock' : `item ${order}`,
							order,
							linkedRecipeId: order === 0 ? linkedRecipeId : undefined,
						})),
					},
					instructions: {
						create: Array.from({ length: 10 }, (_, order) => ({
							content: `Step ${order + 1}: stir and keep going a while.`,
							order,
						})),
					},
				},
			})
		const stock = await longRecipe('Vegetable stock')
		const soup = await longRecipe('Lentil soup', stock.id)
		// The linked Recipe is slow to load, so the push is still on its way
		// when the sheet is opened again.
		await page.route(
			(url) => url.pathname === `/recipes/${stock.id}.data`,
			async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 2000))
				await route.continue()
			},
		)

		await page.goto(`/recipes/${soup.id}`)
		const pill = page.locator('[data-floating-ingredients]')
		const sheet = page.getByRole('dialog', { name: 'Ingredients' })
		await page
			.getByRole('heading', { name: 'Instructions' })
			.scrollIntoViewIfNeeded()
		await hydrated(pill)
		await pill.tap()
		await expect(sheet).toBeVisible()
		await expect(sheet).toHaveAttribute('data-state', 'open')

		// The push hides the sheet; the pill opens it again 80ms later, inside
		// the sheet's exit.
		await page.evaluate(async () => {
			const link = document.querySelector<HTMLAnchorElement>(
				'[data-bottom-sheet] a[href^="/recipes/"]',
			)!
			link.click()
			await new Promise((resolve) => setTimeout(resolve, 80))
			document
				.querySelector<HTMLButtonElement>('[data-floating-ingredients]')!
				.click()
		})
		await expect(sheet).toHaveAttribute('data-state', 'open')
		await expect(sheet).toBeVisible()
		await expect(page.locator('[data-push-dismissed]')).toHaveCount(0)
		await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused()

		await expect(page).toHaveURL(`/recipes/${stock.id}`, { timeout: 10_000 })
		await expect(heading(page, 'Vegetable stock')).toBeVisible()
		await sheet.getByRole('button', { name: 'Close' }).tap()
		await expect(sheet).toBeHidden()
		await page
			.getByRole('heading', { name: 'Instructions' })
			.scrollIntoViewIfNeeded()
		await pill.tap()
		await expect(sheet).toBeVisible()
		await expect(
			sheet.getByRole('checkbox', { name: 'item 1', exact: true }),
		).toBeVisible()
	})

	test('Delete slides back once, also when the list takes the gone Recipe’s place', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const first = await createRecipe(user, 'Lentil soup')
		const second = await createRecipe(user, 'Bean stew')

		const deleteRecipe = async () => {
			await page.getByRole('button', { name: 'Delete Recipe' }).tap()
			await page
				.getByRole('dialog', { name: 'Delete this Recipe?' })
				.getByRole('button', { name: 'Delete Recipe' })
				.tap()
		}

		// The list right behind: a pop back to it.
		await page.goto('/recipes')
		const card = page.getByRole('link', { name: 'Lentil soup recipe' })
		await hydrated(card)
		await ui.expectSlide('forward', () => card.tap())
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Edit Recipe' }).tap(),
		)
		await hydrated(saveButton(page))
		await ui.expectSlide('back', deleteRecipe)
		await expect(page).toHaveURL('/recipes')
		expect(await prisma.recipe.count({ where: { id: first.id } })).toBe(0)

		// Opened cold: a pop over the Recipe, then the list in its place.
		await page.goto(`/recipes/${second.id}`)
		const edit = page.getByRole('link', { name: 'Edit Recipe' })
		await hydrated(edit)
		await ui.settled()
		await ui.expectSlide('forward', () => edit.tap())
		await hydrated(saveButton(page))
		await ui.expectSlide('back', deleteRecipe)
		await expect(page).toHaveURL('/recipes')
		await expect(page.getByText('Recipe not found')).toHaveCount(0)
		expect(await prisma.recipe.count({ where: { id: second.id } })).toBe(0)
	})

	test('a back swipe the system animated is not animated again', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		// The browser marks the popstate of a back it animated itself (WebKit's
		// edge swipe); a back from script, as here, is unmarked, so the test
		// marks it.
		await page.addInitScript(() => {
			Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', {
				configurable: true,
				get: () =>
					(window as unknown as { __uaSwipe?: boolean }).__uaSwipe === true,
			})
		})
		const user = await login()
		const soup = await createRecipe(user, 'Lentil soup')
		await page.goto('/recipes')
		const card = page.getByRole('link', { name: 'Lentil soup recipe' })
		await hydrated(card)
		await ui.expectSlide('forward', () => card.tap())
		await ui.expectSlide('forward', () =>
			page.getByRole('link', { name: 'Edit Recipe' }).tap(),
		)
		const before = (await ui.transitions()).length
		await page.evaluate(() => {
			Object.assign(window, { __uaSwipe: true })
			window.history.back()
		})
		await expect(page).toHaveURL(`/recipes/${soup.id}`)
		await expect
			.poll(async () => (await ui.transitions()).length)
			.toBeGreaterThan(before)
		await ui.settled()
		// The pop's own transition, and any a revalidation starts after it,
		// move nothing.
		const started = (await ui.transitions()).slice(before)
		expect(started[0]?.direction).toBe('none')
		for (const transition of started) {
			expect(transition.animation).toBeNull()
		}
	})

	test.describe('haptics', () => {
		test('ticking ingredients and steps ticks, on and off; loading and refreshing tick nothing', async ({
			page,
			login,
		}) => {
			const ui = await instrument(page)
			const user = await login()
			const soup = await createRecipe(user, 'Lentil soup')
			await page.goto(`/recipes/${soup.id}`)
			const lentils = page
				.locator('main')
				.getByRole('checkbox', { name: 'lentils', exact: true })
				.first()
			await hydrated(lentils)
			await ui.settled()
			expect(await ui.haptics()).toEqual([])

			// A pull to refresh revalidates the page.
			expect(
				await ui.hapticsOf(async () => {
					await page.evaluate(() =>
						window.dispatchEvent(new CustomEvent('qm:refresh')),
					)
					await expect.poll(ui.messages).toContain('refresh:done')
				}),
			).toEqual([])

			expect(await ui.hapticsOf(() => lentils.tap())).toEqual(['selection'])
			await expect(lentils).toHaveAttribute('aria-checked', 'true')
			expect(await ui.hapticsOf(() => lentils.tap())).toEqual(['selection'])
			await expect(lentils).toHaveAttribute('aria-checked', 'false')

			const step = page.locator(`[data-step-id="${soup.instructions[0]!.id}"]`)
			expect(await ui.hapticsOf(() => step.tap())).toEqual(['selection'])
			await expect(step).toHaveAttribute('aria-checked', 'true')

			// The checks come back with the page, without a tick.
			await page.reload()
			await expect(step).toHaveAttribute('aria-checked', 'true')
			await hydrated(step)
			await ui.settled()
			expect(await ui.haptics()).toEqual([])
		})

		test('a Save the server turns down, or one sent offline, lands no success', async ({
			page,
			context,
			login,
		}) => {
			const ui = await instrument(page)
			const user = await login()
			const stock = await createRecipe(user, 'Vegetable stock')
			const soup = await createRecipe(user, 'Lentil soup', {
				linkedRecipeId: stock.id,
			})
			await prisma.menu.create({
				data: {
					title: 'Soup night',
					titleKey: 'soup night',
					householdId: user.householdId,
					sections: { create: { name: null, order: 0 } },
				},
			})

			await page.goto(`/recipes/${soup.id}/edit`)
			await hydrated(saveButton(page))
			await ui.settled()
			await page.getByLabel('Title').fill('Red lentil soup')
			// Only the server can tell: the linked Recipe is gone.
			await prisma.recipe.delete({ where: { id: stock.id } })
			const linkGone = page.getByText(
				'This linked Recipe was deleted. Remove the link to save.',
				{ exact: true },
			)
			expect(
				await ui.hapticsOf(async () => {
					await saveButton(page).tap()
					await expect(linkGone).toBeVisible()
				}),
			).toEqual([])
			await page.getByRole('button', { name: 'Remove Recipe link' }).tap()

			await context.setOffline(true)
			expect(
				await ui.hapticsOf(async () => {
					await saveButton(page).tap()
					await expect(
						page.getByText(
							'You’re offline, so nothing was saved. Your changes are still here.',
						),
					).toBeVisible()
				}),
			).toEqual([])
			await context.setOffline(false)
			expect(
				(await prisma.recipe.findUniqueOrThrow({ where: { id: soup.id } }))
					.title,
			).toBe('Lentil soup')

			expect(
				await ui.hapticsOf(async () => {
					await saveButton(page).tap()
					await expect(page).toHaveURL(`/recipes/${soup.id}`)
				}),
			).toEqual(['success'])

			// A new Menu whose title another Menu has.
			await page.goto('/recipes/menus/new')
			await hydrated(saveButton(page))
			await ui.settled()
			await page.getByLabel('Title').fill('Soup night')
			expect(
				await ui.hapticsOf(async () => {
					await saveButton(page).tap()
					await expect(
						page.getByText('You already have a Menu with this title'),
					).toBeVisible()
				}),
			).toEqual([])
			expect(
				await prisma.menu.count({ where: { householdId: user.householdId } }),
			).toBe(1)
		})

		test('Mark cooked lands as a success, unmarking ticks', async ({
			page,
			login,
		}) => {
			const ui = await instrument(page)
			const user = await login()
			const soup = await createRecipe(user, 'Lentil soup')
			const stew = await createRecipe(user, 'Bean stew')
			const today = todayUTC()
			const weekStart = getWeekStart(today)
			const plan = await prisma.mealPlan.create({
				data: {
					householdId: user.householdId,
					weekStart,
					meals: {
						create: [soup, stew].map((recipe, order) => ({
							date: today,
							order,
							recipeItems: {
								create: {
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									order: 0,
								},
							},
						})),
					},
				},
				include: { meals: { include: { recipeItems: true } } },
			})
			const soupItem = plan.meals[0]!.recipeItems[0]!
			const stewItem = plan.meals[1]!.recipeItems[0]!
			const cooked = (id: string) =>
				prisma.mealRecipeItem
					.findUniqueOrThrow({ where: { id } })
					.then((item) => item.cooked)

			await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
			const mobile = page.getByTestId('mobile-plan')
			const circle = mobile.getByRole('button', {
				name: 'Mark Lentil soup cooked',
			})
			await hydrated(circle)
			await ui.settled()
			expect(await ui.haptics()).toEqual([])

			expect(await ui.hapticsOf(() => circle.tap())).toEqual(['success'])
			await expect.poll(() => cooked(soupItem.id)).toBe(true)
			expect(
				await ui.hapticsOf(() =>
					mobile
						.getByRole('button', { name: 'Mark Lentil soup not cooked' })
						.tap(),
				),
			).toEqual(['selection'])
			await expect.poll(() => cooked(soupItem.id)).toBe(false)

			const actions = mobile.getByRole('button', {
				name: /^Meal actions for .*Bean stew/,
			})
			await actions.tap()
			expect(
				await ui.hapticsOf(() =>
					page.getByRole('menuitem', { name: 'Mark cooked' }).tap(),
				),
			).toEqual(['success'])
			await expect.poll(() => cooked(stewItem.id)).toBe(true)
			// The menu that just closed gives focus back to its button once it
			// has gone. A menu opened before then loses that focus and closes.
			await expect(actions).toBeFocused()
			await actions.tap()
			expect(
				await ui.hapticsOf(() =>
					page.getByRole('menuitem', { name: 'Mark not cooked' }).tap(),
				),
			).toEqual(['selection'])
			await expect.poll(() => cooked(stewItem.id)).toBe(false)
		})

		test('a switch and a new segment tick; the segment already chosen does not', async ({
			page,
			login,
		}) => {
			const ui = await instrument(page)
			await login()
			await page.goto('/settings/profile')
			const keepAwake = page.getByRole('switch', {
				name: 'Keep screen awake while a Recipe is open',
			})
			await expect(keepAwake).toBeEnabled()
			await ui.settled()
			expect(await ui.haptics()).toEqual([])
			const before = await keepAwake.getAttribute('aria-checked')
			expect(await ui.hapticsOf(() => keepAwake.tap())).toEqual(['selection'])
			await expect(keepAwake).not.toHaveAttribute('aria-checked', before!)
			expect(await ui.hapticsOf(() => keepAwake.tap())).toEqual(['selection'])
			await expect(keepAwake).toHaveAttribute('aria-checked', before!)

			await page.goto('/recipes/import')
			const fromText = page.getByRole('tab', { name: 'From text', exact: true })
			await hydrated(fromText)
			await ui.settled()
			expect(await ui.hapticsOf(() => fromText.tap())).toEqual(['selection'])
			await expect(fromText).toHaveAttribute('aria-selected', 'true')
			expect(await ui.hapticsOf(() => fromText.tap())).toEqual([])
			// Arrow keys pick the next segment, as on a native control.
			expect(
				await ui.hapticsOf(() => page.keyboard.press('ArrowLeft')),
			).toEqual(['selection'])
			await expect(
				page.getByRole('tab', { name: 'From URL', exact: true }),
			).toHaveAttribute('aria-selected', 'true')
		})
	})
})

test.describe('in Safari', () => {
	test.use({ userAgent: SAFARI_UA })

	test('pushes do not slide: a Recipe card cross-fades, Edit and Save open at once', async ({
		page,
		login,
	}) => {
		const ui = await instrument(page)
		const user = await login()
		const soup = await createRecipe(user, 'Lentil soup')
		await page.goto('/recipes')
		const card = page.getByRole('link', { name: 'Lentil soup recipe' })
		await hydrated(card)

		const before = (await ui.transitions()).length
		await card.tap()
		await expect(page).toHaveURL(`/recipes/${soup.id}`)
		await ui.settled()
		const started = (await ui.transitions()).slice(before)
		expect(started).toHaveLength(1)
		expect(started[0]!.direction).toBeNull()
		expect(started[0]!.animation).not.toMatch(/^page-/)

		await ui.expectNoTransition(
			() => page.getByRole('link', { name: 'Edit Recipe' }).tap(),
			() => expect(page).toHaveURL(`/recipes/${soup.id}/edit`),
		)
		expect(
			await page.evaluate(() => document.documentElement.dataset.navDirection),
		).toBeUndefined()

		// Saves leave at once too: an edit, and a new Recipe.
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Red lentil soup')
		await ui.expectNoTransition(
			() => saveButton(page).tap(),
			() => expect(heading(page, 'Red lentil soup')).toBeVisible(),
		)
		await page.goto('/recipes/new')
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Bean stew')
		await page.getByLabel('Ingredient 1 name').fill('beans')
		await page.getByLabel('Step 1', { exact: true }).fill('Simmer.')
		await ui.expectNoTransition(
			() => saveButton(page).tap(),
			() => expect(heading(page, 'Bean stew')).toBeVisible(),
		)
		expect(
			await prisma.recipe.count({
				where: { householdId: user.householdId, title: 'Bean stew' },
			}),
		).toBe(1)
	})
})
