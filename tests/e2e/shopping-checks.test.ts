import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

async function setup(userId: string) {
	const household = await prisma.household.create({
		data: {
			name: 'Disposable check test',
			staplesCutoverAt: new Date(),
			members: { create: { userId, role: 'owner' } },
		},
	})
	await prisma.subscription.create({ data: { userId, tier: 'pro' } })
	const list = await prisma.shoppingList.create({
		data: {
			userId,
			householdId: household.id,
			items: {
				create: [
					{ name: 'Rice', quantity: '200', unit: 'g' },
					{ name: 'Bread', checked: true },
				],
			},
		},
		include: { items: true },
	})
	return { household, rice: list.items.find((item) => item.name === 'Rice')! }
}

async function openShopping(page: Page) {
	await page.goto('/shopping')
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll<HTMLInputElement>(
				'input[name="originClientId"]',
			),
		].some((input) => input.value),
	)
}

const riceRow = (page: Page) =>
	page.getByRole('group', { name: 'Rice shopping item' })

function responseGate() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

for (const outcome of ['deleted', 'signed out']) {
	test(`checking stops when the item is ${outcome}`, async ({
		page,
		login,
	}) => {
		const user = await login()
		const { rice } = await setup(user.id)
		await openShopping(page)
		if (outcome === 'deleted')
			await prisma.shoppingListItem.delete({ where: { id: rice.id } })
		else await prisma.session.deleteMany({ where: { userId: user.id } })
		await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
		await expect(page.getByRole('alert')).toContainText(
			outcome === 'deleted' ? 'This item was removed' : 'Reload Shopping',
		)
		await expect(
			page.getByRole('button', { name: 'Retry', exact: true }),
		).toBeHidden()
		if (outcome === 'deleted') await expect(riceRow(page)).toBeHidden()
		else
			await expect(
				riceRow(page).getByRole('button', { name: 'Check off item' }),
			).toBeVisible()
	})
}

test('a failed write is retried once after confirming its original requirement', async ({
	page,
	login,
}) => {
	await setup((await login()).id)
	await openShopping(page)
	const requests: string[] = []
	await page.route('**/resources/shopping-check?*', (route) => {
		requests.push(route.request().method())
		return requests.length === 1 ? route.abort() : route.continue()
	})
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await expect(riceRow(page).getByRole('status')).toBeHidden()
	await expect(
		riceRow(page).getByRole('button', { name: 'Uncheck item' }),
	).toBeVisible()
	expect(requests).toEqual(['POST', 'GET', 'POST'])
})

test('a failed check yields to changed household data on background refresh', async ({
	page,
	login,
}) => {
	const { rice } = await setup((await login()).id)
	await openShopping(page)
	await page.route('**/resources/shopping-check?*', (route) => route.abort())
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await expect(riceRow(page).getByRole('alert')).toBeVisible()
	await prisma.shoppingListItem.update({
		where: { id: rice.id },
		data: { quantity: '600' },
	})
	await page.request.post('/shopping', {
		form: { intent: 'add', name: 'Apples', originClientId: 'another-device' },
	})
	await expect(riceRow(page)).toContainText('600 g')
	await expect(
		riceRow(page).getByRole('button', { name: 'Check off item' }),
	).toBeVisible()
	await expect(
		riceRow(page).getByRole('button', { name: 'Retry' }),
	).toBeHidden()
	await expect(page.getByRole('alert')).toContainText('This item changed')
})

test('failed checks survive refresh and Clear checked; navigation warns only with unsynced intent', async ({
	page,
	login,
}) => {
	const { rice } = await setup((await login()).id)
	await page.setViewportSize({ width: 390, height: 844 })
	await openShopping(page)
	await page.route('**/resources/shopping-check?*', (route) => route.abort())
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await expect(riceRow(page).getByRole('alert')).toContainText(
		'Couldn’t confirm this check',
	)
	await page.screenshot({
		path: test.info().outputPath('failed-check.png'),
		fullPage: true,
	})
	await expect(
		page.getByRole('heading', { name: /Shopping List/ }),
	).toBeVisible()
	page.once('dialog', (dialog) => void dialog.accept())
	await page
		.getByRole('button', { name: 'Clear checked items from Next shop' })
		.click()
	await expect(
		page.getByRole('group', { name: 'Bread shopping item' }),
	).toBeHidden()
	await expect(riceRow(page).getByRole('alert')).toBeVisible()
	page.once('dialog', (dialog) => {
		expect(dialog.message()).toContain('aren’t confirmed')
		void dialog.dismiss()
	})
	await page
		.getByRole('link', { name: 'Recipes', exact: true })
		.filter({ visible: true })
		.click()
	await expect(page).toHaveURL('/shopping')
	await page.unroute('**/resources/shopping-check?*')
	await riceRow(page)
		.getByRole('button', { name: 'Retry', exact: true })
		.click()
	await expect(riceRow(page).getByRole('alert')).toBeHidden()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findUnique({
				where: { id: rice.id },
				select: { checked: true },
			}),
		)
		.toEqual({ checked: true })
	page.once('dialog', () => {
		throw new Error('Confirmed checks must not block navigation')
	})
	await page
		.getByRole('link', { name: 'Recipes', exact: true })
		.filter({ visible: true })
		.click()
	await expect(page).toHaveURL('/recipes')
})

for (const laterChange of [false, true]) {
	test(`lost response reconciles before replay${laterChange ? ' and respects a later device change' : ''}`, async ({
		page,
		login,
	}) => {
		const { rice } = await setup((await login()).id)
		await openShopping(page)
		let writes = 0
		await page.route('**/resources/shopping-check?*', async (route) => {
			if (route.request().method() !== 'POST') return route.continue()
			writes++
			const response = await route.fetch()
			const { item } = await response.json()
			if (laterChange) {
				await page.request.post('/resources/shopping-check', {
					form: {
						itemId: rice.id,
						checked: 'false',
						observedVersion: String(item.checkVersion),
						mutationId: 'other-device-uncheck',
						originClientId: 'other-device',
					},
				})
			}
			await route.abort()
		})
		await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
		await expect(riceRow(page).getByRole('status')).toBeHidden()
		await expect(
			riceRow(page).getByRole('button', {
				name: laterChange ? 'Check off item' : 'Uncheck item',
				exact: true,
			}),
		).toHaveAttribute('aria-pressed', String(!laterChange))
		if (laterChange)
			await expect(page.getByRole('alert')).toContainText('This item changed')
		expect(writes).toBe(1)
		await expect
			.poll(() =>
				prisma.shoppingListItem.findUnique({
					where: { id: rice.id },
					select: { checked: true },
				}),
			)
			.toEqual({ checked: !laterChange })
	})
}

test('rapid taps coalesce while background refresh cannot overwrite pending intent', async ({
	page,
	login,
}) => {
	const { rice } = await setup((await login()).id)
	await openShopping(page)
	let release!: () => void
	const held = new Promise<void>((resolve) => {
		release = resolve
	})
	let committed!: () => void
	const didCommit = new Promise<void>((resolve) => {
		committed = resolve
	})
	let writes = 0
	await page.route('**/resources/shopping-check?*', async (route) => {
		if (route.request().method() !== 'POST') return route.continue()
		writes++
		if (writes > 1) return route.continue()
		const response = await route.fetch()
		committed()
		await held
		await route.fulfill({ response })
	})
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await didCommit
	await riceRow(page).getByRole('button', { name: 'Uncheck item' }).click()
	await page.request.post('/shopping', {
		form: { intent: 'add', name: 'Apples', originClientId: 'other-device' },
	})
	await expect(
		page.getByRole('group', { name: 'Apples shopping item' }),
	).toBeVisible()
	await expect(
		riceRow(page).getByRole('button', { name: 'Check off item' }),
	).toHaveAttribute('aria-pressed', 'false')
	await expect(riceRow(page).getByRole('status')).toBeVisible()
	release()
	await expect(riceRow(page).getByRole('status')).toBeHidden()
	expect(writes).toBe(2)
	await expect
		.poll(() =>
			prisma.shoppingListItem.findUnique({
				where: { id: rice.id },
				select: { checked: true },
			}),
		)
		.toEqual({ checked: false })
})

test('reversing an uncertain check cannot be undone by its delayed original request', async ({
	page,
	login,
}) => {
	const { rice } = await setup((await login()).id)
	await openShopping(page)
	const failed = responseGate()
	let delayedForm: Record<string, string> | undefined
	await page.route('**/resources/shopping-check?*', async (route) => {
		if (route.request().method() !== 'POST' || delayedForm)
			return route.continue()
		delayedForm = Object.fromEntries(
			new URLSearchParams(route.request().postData()!),
		)
		await failed.promise
		await route.abort()
	})
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await expect.poll(() => delayedForm).toBeDefined()
	await riceRow(page).getByRole('button', { name: 'Uncheck item' }).click()
	failed.resolve()
	await expect(riceRow(page).getByRole('status')).toBeHidden()
	await expect(riceRow(page).getByRole('alert')).toBeHidden()

	// Losing the response does not cancel server work. Deliver that same
	// original request only after the page has declared the reversal settled.
	await page.request.post('/resources/shopping-check', { form: delayedForm! })
	expect(
		await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: rice.id },
			select: { checked: true },
		}),
	).toEqual({ checked: false })
	await expect(
		riceRow(page).getByRole('button', { name: 'Check off item' }),
	).toHaveAttribute('aria-pressed', 'false')
})

test('a late successful response yields to a newer requirement already refreshed on the page', async ({
	page,
	login,
}) => {
	const { rice } = await setup((await login()).id)
	await openShopping(page)
	const committed = responseGate()
	const release = responseGate()
	await page.route('**/resources/shopping-check?*', async (route) => {
		const response = await route.fetch()
		committed.resolve()
		await release.promise
		await route.fulfill({ response })
	})
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await committed.promise
	await prisma.shoppingListItem.update({
		where: { id: rice.id },
		data: { quantity: '600', checked: false },
	})
	await page.request.post('/shopping', {
		form: { intent: 'add', name: 'Apples', originClientId: 'another-device' },
	})
	await expect(
		page.getByRole('group', { name: 'Apples shopping item' }),
	).toBeVisible()
	await expect(riceRow(page)).toContainText('200 g')
	await expect(riceRow(page).getByRole('status')).toBeVisible()
	release.resolve()
	await expect(riceRow(page).getByRole('status')).toBeHidden()
	await expect(riceRow(page)).toContainText('600 g')
	await expect(
		riceRow(page).getByRole('button', { name: 'Check off item' }),
	).toHaveAttribute('aria-pressed', 'false')
	await expect(page.getByRole('alert')).toContainText('This item changed')
})

test('stalled writes have a deadline and stop after one unsuccessful automatic replay', async ({
	page,
	login,
}) => {
	await setup((await login()).id)
	await page.clock.install()
	await openShopping(page)
	const requests: string[] = []
	await page.route('**/resources/shopping-check?*', (route) => {
		requests.push(route.request().method())
		if (route.request().method() === 'GET') return route.continue()
		// Intentionally never answer either write; the browser must abort it.
	})
	await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
	await expect.poll(() => requests).toEqual(['POST'])
	await page.clock.fastForward(8_100)
	await expect.poll(() => requests).toEqual(['POST', 'GET', 'POST'])
	await page.clock.fastForward(8_100)
	await expect(riceRow(page).getByRole('alert')).toContainText(
		'Couldn’t confirm this check',
	)
	await page.clock.fastForward(60_000)
	expect(requests).toEqual(['POST', 'GET', 'POST', 'GET'])
	await expect(
		riceRow(page).getByRole('button', { name: 'Retry' }),
	).toBeVisible()
})

for (const fallback of [false, true]) {
	test(`same account on desktop and phone receives additions, checks and clears via ${fallback ? 'polling' : 'SSE'}`, async ({
		page,
		login,
	}) => {
		test.setTimeout(45_000)
		await setup((await login()).id)
		await openShopping(page)
		const phone = await page.context().newPage()
		await phone.setViewportSize({ width: 390, height: 844 })
		if (fallback) {
			await phone.clock.install()
			await phone.route('**/resources/household-events', (route) =>
				route.abort(),
			)
		}
		await openShopping(phone)
		async function catchUp() {
			if (fallback) {
				await phone.clock.fastForward(30_100)
				await phone.waitForTimeout(100)
				await phone.clock.fastForward(600)
			}
		}
		await page
			.getByPlaceholder('Add an item...')
			.filter({ visible: true })
			.fill('Apples')
		await page
			.getByRole('button', { name: 'Add to Next shop' })
			.filter({ visible: true })
			.click()
		await expect(
			page.getByRole('group', { name: 'Apples shopping item' }),
		).toBeVisible()
		await catchUp()
		await expect(
			phone.getByRole('group', { name: 'Apples shopping item' }),
		).toBeVisible()
		await expect(
			page.getByPlaceholder('Add an item...').filter({ visible: true }),
		).toHaveValue('')
		let originRefreshes = 0
		const countOriginRefresh = (request: {
			method(): string
			url(): string
		}) => {
			if (
				request.method() === 'GET' &&
				request.url().includes('/shopping.data')
			)
				originRefreshes++
		}
		page.on('request', countOriginRefresh)
		await riceRow(page).getByRole('button', { name: 'Check off item' }).click()
		await expect(riceRow(page).getByRole('status')).toBeHidden()
		await catchUp()
		await expect(
			riceRow(phone).getByRole('button', { name: 'Uncheck item' }),
		).toBeVisible()
		expect(originRefreshes).toBe(0)
		await expect(
			page.locator('[aria-label$=" shopping item"]').last(),
		).toHaveAttribute('aria-label', 'Rice shopping item')
		page.off('request', countOriginRefresh)
		page.once('dialog', (dialog) => void dialog.accept())
		await page
			.getByRole('button', { name: 'Clear checked items from Next shop' })
			.click()
		await expect(riceRow(page)).toBeHidden()
		await catchUp()
		await expect(riceRow(phone)).toBeHidden()
		await phone.close()
	})
}
