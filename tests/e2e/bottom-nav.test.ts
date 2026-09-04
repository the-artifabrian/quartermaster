import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

const TRACE_ONLY = process.env.BOTTOM_NAV_TRACE_ONLY === '1'
const ROUTE_DELAY_MS = 300

type Destination = {
	label: 'Recipes' | 'Staples' | 'Plan' | 'Shop'
	path: '/recipes' | '/inventory' | '/plan' | '/shopping'
}

const destinations: Destination[] = [
	{ label: 'Recipes', path: '/recipes' },
	{ label: 'Staples', path: '/inventory' },
	{ label: 'Plan', path: '/plan' },
	{ label: 'Shop', path: '/shopping' },
]

type TraceMetric = {
	destination: Destination['label']
	inputToFeedbackMs: number | null
	inputToIdleMs: number | null
	dataDurationMs: number | null
	dataTransferBytes: number | null
	dataBodyBytes: number | null
	dataRequests: number
	lateRouteChunks: number
}

type TransferTracker = {
	bytesByPath: Map<string, number>
}

function dataPath(url: string) {
	return new URL(url).pathname.match(
		/^\/(recipes|inventory|plan|shopping)\.data$/,
	)?.[1]
}

function bottomNav(page: Page) {
	return page
		.getByRole('navigation', { name: 'Main' })
		.filter({ has: page.getByRole('link', { name: 'Shop', exact: true }) })
}

async function trackDataTransfer(page: Page): Promise<TransferTracker> {
	const session = await page.context().newCDPSession(page)
	const pathByRequestId = new Map<string, string>()
	const bytesByPath = new Map<string, number>()
	await session.send('Network.enable')
	session.on('Network.requestWillBeSent', (event) => {
		const path = dataPath(event.request.url)
		if (path) pathByRequestId.set(event.requestId, `/${path}`)
	})
	session.on('Network.loadingFinished', (event) => {
		const path = pathByRequestId.get(event.requestId)
		if (!path) return
		bytesByPath.set(
			path,
			(bytesByPath.get(path) ?? 0) + event.encodedDataLength,
		)
		pathByRequestId.delete(event.requestId)
	})
	return { bytesByPath }
}

async function installTraceProbe(link: Locator) {
	await link.evaluate((element) => {
		type Probe = {
			inputAt: number | null
			feedbackAt: number | null
			idleAt: number | null
		}
		const windowWithProbe = window as typeof window & {
			__bottomNavProbe?: Probe
		}
		performance.clearResourceTimings()
		const probe: Probe = {
			inputAt: null,
			feedbackAt: null,
			idleAt: null,
		}
		windowWithProbe.__bottomNavProbe = probe

		const isFeedbackVisible = () =>
			element.hasAttribute('data-pressed') ||
			element.hasAttribute('data-pending') ||
			element.getAttribute('aria-current') === 'page'
		const recordVisualState = () => {
			if (probe.inputAt == null) return
			if (probe.feedbackAt == null && isFeedbackVisible()) {
				requestAnimationFrame(() => {
					probe.feedbackAt ??= performance.now()
				})
			}
			if (
				probe.idleAt == null &&
				element.getAttribute('aria-current') === 'page' &&
				!element.hasAttribute('data-pending')
			) {
				requestAnimationFrame(() => {
					probe.idleAt ??= performance.now()
				})
			}
		}
		const observer = new MutationObserver(recordVisualState)
		observer.observe(element, {
			attributes: true,
			childList: true,
			subtree: true,
		})
		const recordInput = () => {
			if (probe.inputAt == null) {
				probe.inputAt = performance.now()
				recordVisualState()
			}
		}
		element.addEventListener('pointerdown', recordInput, {
			capture: true,
			once: true,
		})
		element.addEventListener(
			'keydown',
			(event) => {
				if ((event as KeyboardEvent).key === 'Enter') recordInput()
			},
			{ capture: true, once: true },
		)
	})
}

async function traceTouchNavigation(
	page: Page,
	destination: Destination,
	requestCounts: Map<string, number>,
	transferTracker: TransferTracker,
): Promise<TraceMetric> {
	const link = bottomNav(page).getByRole('link', {
		name: destination.label,
		exact: true,
	})
	await installTraceProbe(link)
	const requestCountBefore = requestCounts.get(destination.path) ?? 0
	const transferBytesBefore =
		transferTracker.bytesByPath.get(destination.path) ?? 0

	await link.dispatchEvent('pointerdown', {
		button: 0,
		buttons: 1,
		isPrimary: true,
		pointerId: 1,
		pointerType: 'touch',
	})
	await link.dispatchEvent('touchstart')
	await link.dispatchEvent('pointerup', {
		button: 0,
		buttons: 0,
		isPrimary: true,
		pointerId: 1,
		pointerType: 'touch',
	})
	await link.dispatchEvent('touchend')
	await link.dispatchEvent('click', { button: 0, detail: 1 })

	await expect(page).toHaveURL(destination.path)
	if (!TRACE_ONLY) {
		await expect(link).not.toHaveAttribute('data-pending', /.+/)
	}
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
	// Let any delayed prefetch started by this input finish so duplicate bytes are
	// attributed to the same destination trace instead of leaking into the next row.
	await page.waitForTimeout(ROUTE_DELAY_MS + 50)

	const browserMetric = await page.evaluate((path) => {
		const probe = (
			window as typeof window & {
				__bottomNavProbe?: {
					inputAt: number | null
					feedbackAt: number | null
					idleAt: number | null
				}
			}
		).__bottomNavProbe
		const entry = (
			performance.getEntriesByType('resource') as PerformanceResourceTiming[]
		)
			.filter(
				(candidate) => new URL(candidate.name).pathname === `${path}.data`,
			)
			.at(-1)
		const lateRouteChunks = (
			performance.getEntriesByType('resource') as PerformanceResourceTiming[]
		).filter(
			(candidate) =>
				probe?.inputAt != null &&
				candidate.startTime >= probe.inputAt &&
				new URL(candidate.name).pathname.endsWith('.js'),
		).length
		return {
			inputToFeedbackMs:
				probe?.inputAt != null && probe.feedbackAt != null
					? probe.feedbackAt - probe.inputAt
					: null,
			inputToIdleMs:
				probe?.inputAt != null && probe.idleAt != null
					? probe.idleAt - probe.inputAt
					: null,
			dataDurationMs: entry?.duration ?? null,
			dataBodyBytes: entry?.encodedBodySize ?? null,
			lateRouteChunks,
		}
	}, destination.path)

	return {
		destination: destination.label,
		...browserMetric,
		dataTransferBytes:
			(transferTracker.bytesByPath.get(destination.path) ?? 0) -
			transferBytesBefore,
		dataRequests:
			(requestCounts.get(destination.path) ?? 0) - requestCountBefore,
	}
}

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

test('all four bottom tabs acknowledge touch and make one fresh data request', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Bottom navigation trace Household',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Bottom Nav Recipe',
			userId: user.id,
			householdId: household.id,
		},
	})
	await prisma.subscription.create({
		data: { userId: user.id, tier: 'pro' },
	})

	const requestCounts = new Map<string, number>()
	const transferTracker = await trackDataTransfer(page)
	await page.addInitScript(() => {
		const original = document.startViewTransition?.bind(document)
		const windowWithCount = window as typeof window & {
			__bottomNavViewTransitions: number
		}
		windowWithCount.__bottomNavViewTransitions = 0
		if (!original) return
		document.startViewTransition = (...args) => {
			windowWithCount.__bottomNavViewTransitions++
			return original(...args)
		}
	})
	await page.route(
		/\/(recipes|inventory|plan|shopping)\.data(?:\?|$)/,
		async (route) => {
			const path = dataPath(route.request().url())
			if (path) {
				const destinationPath = `/${path}`
				requestCounts.set(
					destinationPath,
					(requestCounts.get(destinationPath) ?? 0) + 1,
				)
			}
			await new Promise((resolve) => setTimeout(resolve, ROUTE_DELAY_MS))
			await route.continue()
		},
	)
	await page.route('**/resources/household-events', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/event-stream',
			body: `event: activity\ndata: ${JSON.stringify({
				id: 'bottom-nav-shopping-activity',
				type: 'shopping_list_item_added',
				payload: { name: 'Milk' },
				userId: 'another-household-member',
				username: 'Another member',
				householdId: household.id,
				createdAt: new Date().toISOString(),
			})}\n\n`,
		})
	})

	await page.goto('/settings/profile')
	const nav = bottomNav(page)
	await expect(nav).toBeVisible()
	await expect(nav.getByTestId('shopping-activity-dot')).toBeVisible()
	await page.waitForTimeout(150)
	expect(
		[...requestCounts.values()].reduce((sum, count) => sum + count, 0),
	).toBe(0)

	const trace: TraceMetric[] = []
	for (const destination of destinations) {
		trace.push(
			await traceTouchNavigation(
				page,
				destination,
				requestCounts,
				transferTracker,
			),
		)
		if (destination.path !== '/shopping') {
			await expect(nav.getByTestId('shopping-activity-dot')).toBeVisible()
		}
	}
	await expect(nav.getByTestId('shopping-activity-dot')).toHaveCount(0)

	console.log(`BOTTOM_NAV_TRACE ${JSON.stringify(trace)}`)
	if (TRACE_ONLY) return

	for (const metric of trace) {
		expect(metric.inputToFeedbackMs).not.toBeNull()
		expect(metric.inputToFeedbackMs!).toBeLessThan(34)
		expect(metric.inputToIdleMs).not.toBeNull()
		expect(metric.dataRequests).toBe(1)
		expect(metric.dataTransferBytes).toBeGreaterThan(0)
	}
	expect(
		await page.evaluate(
			() =>
				(
					window as typeof window & {
						__bottomNavViewTransitions?: number
					}
				).__bottomNavViewTransitions ?? 0,
		),
	).toBeGreaterThanOrEqual(destinations.length)

	const recipesLink = nav.getByRole('link', { name: 'Recipes', exact: true })
	const requestCountBeforeCancel = requestCounts.get('/recipes') ?? 0
	await recipesLink.dispatchEvent('pointerdown', {
		button: 0,
		buttons: 1,
		isPrimary: true,
		pointerId: 2,
		pointerType: 'touch',
	})
	await expect(recipesLink).toHaveAttribute('data-pressed', 'true')
	await expect(recipesLink).not.toHaveAttribute('aria-current')
	await recipesLink.dispatchEvent('pointercancel', {
		button: 0,
		buttons: 0,
		isPrimary: true,
		pointerId: 2,
		pointerType: 'touch',
	})
	await expect(recipesLink).not.toHaveAttribute('data-pressed')
	await page.waitForTimeout(ROUTE_DELAY_MS + 50)
	await expect(page).toHaveURL('/shopping')
	expect(requestCounts.get('/recipes') ?? 0).toBe(requestCountBeforeCancel)

	const planLink = nav.getByRole('link', { name: 'Plan', exact: true })
	const shopLink = nav.getByRole('link', { name: 'Shop', exact: true })
	await installTraceProbe(planLink)
	await planLink.focus()
	await page.keyboard.down('Enter')
	await expect(planLink).toHaveAttribute('data-pending', 'true')
	await expect(planLink).not.toHaveAttribute('aria-current')
	await expect(shopLink).toHaveAttribute('aria-current', 'page')
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	)
	const keyboardFeedbackMs = await page.evaluate(() => {
		const probe = (
			window as typeof window & {
				__bottomNavProbe?: {
					inputAt: number | null
					feedbackAt: number | null
				}
			}
		).__bottomNavProbe
		return probe?.inputAt != null && probe.feedbackAt != null
			? probe.feedbackAt - probe.inputAt
			: null
	})
	expect(keyboardFeedbackMs).not.toBeNull()
	expect(keyboardFeedbackMs!).toBeLessThan(34)
	await page.keyboard.up('Enter')
	await expect(page).toHaveURL('/plan')
	await expect(planLink).not.toHaveAttribute('data-pending')
	expect(requestCounts.get('/plan')).toBe(2)

	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.getByRole('heading', { name: recipe.title })).toBeVisible()
	const detailNav = bottomNav(page)
	await detailNav.getByRole('link', { name: 'Shop', exact: true }).click()
	await expect(page).toHaveURL('/shopping')
	expect(requestCounts.get('/shopping')).toBe(2)
	const restoreRecipesLink = detailNav.getByRole('link', {
		name: 'Recipes',
		exact: true,
	})
	await expect(restoreRecipesLink).toHaveAttribute(
		'href',
		`/recipes/${recipe.id}`,
	)
	await restoreRecipesLink.click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await restoreRecipesLink.click()
	await expect(page).toHaveURL('/recipes')
	expect(requestCounts.get('/recipes')).toBe(2)
	await page.goBack()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await page.goForward()
	await expect(page).toHaveURL('/recipes')
})

test('pending feedback clears when a tab navigation is interrupted or fails', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.household.create({
		data: {
			name: 'Bottom navigation interruption Household',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})

	await page.route(/\/plan\.data(?:\?|$)/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 800))
		await route.continue().catch(() => {})
	})
	await page.route(/\/recipes\.data(?:\?|$)/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 200))
		await route.continue()
	})
	await page.route(/\/shopping\.data(?:\?|$)/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 200))
		await route.abort('failed')
	})

	await page.goto('/settings/profile')
	const nav = bottomNav(page)
	const planLink = nav.getByRole('link', { name: 'Plan', exact: true })
	const recipesLink = nav.getByRole('link', { name: 'Recipes', exact: true })
	await planLink.click()
	await expect(planLink).toHaveAttribute('data-pending', 'true')
	await recipesLink.click()
	await expect(planLink).not.toHaveAttribute('data-pending')
	await expect(recipesLink).toHaveAttribute('data-pending', 'true')
	await expect(page).toHaveURL('/recipes')
	await expect(recipesLink).not.toHaveAttribute('data-pending')

	const shopLink = nav.getByRole('link', { name: 'Shop', exact: true })
	await shopLink.click()
	await expect(shopLink).toHaveAttribute('data-pending', 'true')
	await expect
		.poll(async () => {
			const committedShopLink = page.getByRole('link', {
				name: 'Shop',
				exact: true,
			})
			return (await committedShopLink.count()) === 0
				? null
				: await committedShopLink.getAttribute('data-pending')
		})
		.toBeNull()
})
