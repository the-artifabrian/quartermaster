import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

async function openShopping(
	page: Page,
	user: { id: string; householdId: string },
) {
	await prisma.shoppingList.create({
		data: { userId: user.id, householdId: user.householdId },
	})
	await page.goto('/shopping')
	// Shopping fills its client id once it has hydrated.
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll<HTMLInputElement>(
				'input[name="originClientId"]',
			),
		].some((input) => input.value),
	)
}

type Transition = {
	property: string
	duration: number
	from: string | null
	state: string | null
}

/**
 * Opens the add sheet, holds its entrance 40% of the way in, closes it with
 * Escape, and reports the transitions on the panel at both moments. Holding
 * the entrance keeps a loaded machine from closing a sheet that has not
 * moved yet, which has nothing to turn around.
 */
function openThenCloseEarly(page: Page) {
	return page.evaluate(async () => {
		const frame = () =>
			new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
		const transitionsOf = (panel: Element): Transition[] =>
			panel.getAnimations().map((animation) => {
				const transition = animation as CSSTransition
				const [first] = transition.effect
					? (transition.effect as KeyframeEffect).getKeyframes()
					: []
				return {
					property: transition.transitionProperty,
					duration: Number(transition.effect?.getTiming().duration),
					from: first ? String(first[transition.transitionProperty]) : null,
					state: panel.getAttribute('data-state'),
				}
			})
		document
			.querySelector<HTMLButtonElement>('button[aria-label="Add item"]')!
			.click()
		await frame()
		const panel = document.querySelector('[data-bottom-sheet-panel]')!
		const entering = transitionsOf(panel)
		for (const animation of panel.getAnimations()) {
			animation.pause()
			animation.currentTime =
				Number(animation.effect?.getTiming().duration) * 0.4
		}
		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
		)
		// Read the exit as soon as React has committed the close.
		const startedAt = performance.now()
		while (panel.getAttribute('data-state') !== 'closed') {
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
		const leaving = transitionsOf(panel)
		return {
			entering,
			leaving,
			closeMs: performance.now() - startedAt,
			connected: panel.isConnected,
		}
	})
}

/** How far down a keyframe's `translateY(…%)` puts the panel, in percent. */
function percentDown(transform: string | null) {
	const percent = transform?.match(/^translateY\((-?[\d.]+)%\)$/)?.[1]
	return percent ? Number(percent) : NaN
}

test('the add sheet slides up, and a close mid-entrance turns it around', async ({
	page,
	login,
}) => {
	await openShopping(page, await login())
	const { entering, leaving, closeMs, connected } =
		await openThenCloseEarly(page)

	expect(entering).toContainEqual(
		expect.objectContaining({
			property: 'transform',
			duration: 320,
			state: 'open',
		}),
	)
	// The exit starts from where the entrance had got to, not from either end,
	// and takes at most its 200 ms (a reversal is shortened to match).
	const exit = leaving.find((t) => t.property === 'transform')
	expect(
		leaving.map((t) => t.property),
		JSON.stringify({ entering, leaving, closeMs }),
	).toContain('transform')
	expect(exit!.duration).toBeGreaterThan(0)
	expect(exit!.duration).toBeLessThanOrEqual(200)
	const from = percentDown(exit!.from)
	expect(from, String(exit!.from)).toBeGreaterThan(0)
	expect(from, String(exit!.from)).toBeLessThan(100)
	// The panel is still there while it leaves, then goes.
	expect(connected).toBe(true)
	await expect(
		page.getByRole('dialog', { name: 'Add to Shopping' }),
	).toBeHidden()

	// It opens again from the start.
	await page.getByRole('button', { name: 'Add item' }).click()
	await expect(
		page
			.getByRole('dialog', { name: 'Add to Shopping' })
			.getByPlaceholder('Add an item...'),
	).toBeFocused()
})

test('with reduced motion, the add sheet fades in and out without moving', async ({
	page,
	login,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await openShopping(page, await login())
	const { entering, leaving } = await openThenCloseEarly(page)

	for (const transitions of [entering, leaving]) {
		expect(transitions.map((t) => t.property)).not.toContain('transform')
	}
	expect(entering).toContainEqual(
		expect.objectContaining({ property: 'opacity', duration: 120 }),
	)
	const exit = leaving.find((t) => t.property === 'opacity')
	expect(exit!.duration).toBeGreaterThan(0)
	expect(exit!.duration).toBeLessThanOrEqual(120)
	await expect(
		page.getByRole('dialog', { name: 'Add to Shopping' }),
	).toBeHidden()
})

test('Escape, the backdrop and Close each close the add sheet, and focus comes back to Add item', async ({
	page,
	login,
}) => {
	await openShopping(page, await login())
	const addItem = page.getByRole('button', { name: 'Add item' })
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })

	await addItem.focus()
	await page.keyboard.press('Enter')
	await expect(sheet.getByPlaceholder('Add an item...')).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(sheet).toBeHidden()
	await expect(addItem).toBeFocused()

	await addItem.click()
	await expect(sheet).toBeVisible()
	// The backdrop, above the sheet.
	await page.mouse.click(195, 200)
	await expect(sheet).toBeHidden()

	await addItem.click()
	await sheet.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(sheet).toBeHidden()
	await expect(addItem).toBeVisible()
})

/** Records each Shopping row as it mounts, with the transitions it starts. */
async function recordRowMounts(page: Page) {
	await page.evaluate(() => {
		const mounts: Array<{
			name: string | null
			optimistic: boolean
			transitions: string[]
		}> = []
		Object.assign(window, { __rowMounts: mounts })
		new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) continue
					const rows = node.matches('[aria-label$=" shopping item"]')
						? [node]
						: [...node.querySelectorAll('[aria-label$=" shopping item"]')]
					for (const row of rows) {
						mounts.push({
							name: row.getAttribute('aria-label'),
							optimistic: row.hasAttribute('data-optimistic-row'),
							transitions: row
								.getAnimations()
								.map((a) => (a as CSSTransition).transitionProperty)
								.sort(),
						})
					}
				}
			}
		}).observe(document.body, { childList: true, subtree: true })
	})
	return () =>
		page.evaluate(
			() =>
				(
					window as unknown as {
						__rowMounts: Array<{
							name: string | null
							optimistic: boolean
							transitions: string[]
						}>
					}
				).__rowMounts,
		)
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`a new Shopping row eases in and the saved row does not (${reducedMotion})`, async ({
		page,
		login,
	}) => {
		await page.emulateMedia({ reducedMotion })
		const user = await login()
		await openShopping(page, user)
		// Hold the add so the row added just now is on screen for a while.
		await page.route('**/shopping.data**', async (route) => {
			if (route.request().postData()?.includes('intent=add')) {
				await new Promise((resolve) => setTimeout(resolve, 400))
			}
			await route.continue()
		})
		const rowMounts = await recordRowMounts(page)

		await page.getByRole('button', { name: 'Add item' }).click()
		await page
			.getByRole('dialog', { name: 'Add to Shopping' })
			.getByPlaceholder('Add an item...')
			.fill('Bananas')
		await page.keyboard.press('Enter')
		await expect(
			page.locator('[data-optimistic-row][aria-label="Bananas shopping item"]'),
		).toBeVisible()
		await expect(
			page.locator('[data-optimistic-row][aria-label="Bananas shopping item"]'),
		).toHaveCount(0)
		await expect(
			page.getByRole('group', { name: 'Bananas shopping item' }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.shoppingListItem.count({
					where: { name: 'Bananas', list: { householdId: user.householdId } },
				}),
			)
			.toBe(1)

		const mounts = (await rowMounts()).filter(
			(m) => m.name === 'Bananas shopping item',
		)
		expect(mounts).toEqual([
			{
				name: 'Bananas shopping item',
				optimistic: true,
				transitions:
					reducedMotion === 'reduce' ? ['opacity'] : ['opacity', 'transform'],
			},
			{ name: 'Bananas shopping item', optimistic: false, transitions: [] },
		])
	})
}
