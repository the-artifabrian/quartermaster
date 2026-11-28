/**
 * Render the link preview image (1200×630) from the homepage hero.
 *
 * Start the app first (a production build is what it was made against), then
 * run:
 *   bun other/generate-og-image.ts [origin]
 * The origin defaults to http://localhost:3000.
 *
 * It opens the real homepage in light and keeps the headline and the hero's
 * Plan on today. The subhead, the buttons and the header's Log in are hidden
 * because nobody can read or tap them in a preview card, and so is the
 * Shopping phone behind the Plan: one phone can be drawn larger than the page
 * draws it, so its text still reads when a chat app shows the card 500px
 * wide. The phone runs off the bottom edge as the hero cuts it. The page is
 * laid out 1200 CSS px wide, shot at twice the output size and scaled down,
 * so the text stays sharp. The Plan shows the day the script runs.
 * The output is fingerprinted by the build, so a new image gets a new URL and
 * link previews pick it up.
 */
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const origin = process.argv[2] ?? 'http://localhost:3000'
const output = fileURLToPath(
	new URL('../app/assets/og-image.png', import.meta.url),
)
const [width, height] = [1200, 630]

const composition = {
	/** The headline's size, the page's own on a wide screen. Its lines must
	 *  break as the page's do. */
	headlinePx: 88,
	/** The phone's size against the 390px screen it draws. At 1.2 the small
	 *  labels are still about 6.5px in a card shown 500px wide. */
	phoneScale: 1.2,
	/** From the header's hairline to the top of the phone. */
	phoneTopPx: 46,
}

const browser = await chromium.launch()
try {
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 2,
		colorScheme: 'light',
	})
	// The hints the page's own check would write on a first visit, so the
	// page is light from its first load and never reloads under the script.
	const { hostname } = new URL(origin)
	await context.addCookies(
		[
			['CH-prefers-color-scheme', 'light'],
			['CH-time-zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
		].map(([name, value]) => ({
			name: name!,
			value: encodeURIComponent(value!),
			domain: hostname,
			path: '/',
		})),
	)
	const page = await context.newPage()
	await page.goto(origin)
	await page.evaluate(async (composition) => {
		const changed = (what: string) =>
			new Error(`The homepage ${what} has changed; update this script.`)
		if (document.documentElement.classList.contains('dark')) {
			throw new Error('The homepage came up dark; the image is light.')
		}
		const heading = document.querySelector('h1')
		const hero = heading?.closest('section')
		const header = document.querySelector('header')
		const column = heading?.parentElement
		const grid = column?.parentElement
		if (!heading || !hero || !header || !column || !grid) throw changed('hero')
		// The hero's pair: Shopping behind, kept out of the accessibility
		// tree, and the Plan on today in front. Only the Plan is kept.
		const frames = [...hero.querySelectorAll<HTMLElement>('[data-phone-frame]')]
		const [shopping, plan] = frames
		const pair = plan?.parentElement
		if (
			frames.length !== 2 ||
			!shopping ||
			!plan ||
			!pair ||
			pair.parentElement !== grid ||
			shopping.getAttribute('aria-hidden') !== 'true' ||
			!plan.getAttribute('aria-label')?.startsWith('The Plan on a phone')
		) {
			throw changed('pair of phones')
		}
		const logIn = header.querySelectorAll<HTMLElement>('a[href^="/login"]')
		if (logIn.length === 0) throw changed('header Log in link')
		const bar = header.querySelector<HTMLElement>('.container')
		if (!bar) throw changed('header')

		/** The headline's lines, as the words that share a top edge. */
		const lines = () => {
			const text = heading.firstChild
			if (!(text instanceof Text)) throw changed('headline')
			const rows = new Map<number, string[]>()
			for (const word of text.data.matchAll(/\S+/g)) {
				const range = document.createRange()
				range.setStart(text, word.index)
				range.setEnd(text, word.index + word[0].length)
				const top = Math.round(range.getBoundingClientRect().top)
				rows.set(top, [...(rows.get(top) ?? []), word[0]])
			}
			return [...rows.values()].map((row) => row.join(' ')).join(' / ')
		}
		await document.fonts.ready
		const pageLines = lines()

		for (const el of column.children) {
			if (el !== heading) (el as HTMLElement).style.display = 'none'
		}
		for (const link of logIn) link.style.visibility = 'hidden'
		heading.style.fontSize = `${composition.headlinePx}px`

		// The hero fills the picture under the header. The headline is centred
		// in it and the Plan starts near its top and runs off its foot.
		hero.style.height = `${window.innerHeight - header.getBoundingClientRect().bottom}px`
		hero.style.overflow = 'hidden'
		hero.style.borderBottomWidth = '0'
		// The page's containers stop at 1024px here; the picture uses its
		// whole width, inside the page's own gutters.
		bar.style.maxWidth = 'none'
		grid.style.maxWidth = 'none'
		grid.style.height = '100%'
		grid.style.gridTemplateRows = '100%'
		column.style.paddingBlock = '0'
		pair.style.setProperty('--phone-scale', String(composition.phoneScale))
		pair.style.alignSelf = 'start'
		pair.style.marginTop = `${composition.phoneTopPx}px`
		// The Plan alone: the pair is as wide as one phone, with the Plan at
		// its top.
		shopping.style.display = 'none'
		plan.style.top = '0'
		pair.style.width = 'calc(var(--phone-scale) * 390px + 12px)'
		document.documentElement.style.overflow = 'hidden'
		document.documentElement.style.scrollbarGutter = 'auto'
		await Promise.all(
			[...document.images].map((img) => img.decode().catch(() => {})),
		)

		if (lines() !== pageLines) {
			throw new Error(
				`The headline breaks as "${lines()}" where the page has "${pageLines}"; change headlinePx or phoneScale.`,
			)
		}
		// The Plan is whole from side to side and runs off the bottom edge
		// alone.
		const phone = plan.getBoundingClientRect()
		if (
			phone.top < header.getBoundingClientRect().bottom ||
			phone.bottom < window.innerHeight ||
			phone.right > window.innerWidth
		) {
			throw new Error(
				'The Plan no longer runs off the bottom edge alone; change phoneScale or phoneTopPx.',
			)
		}
		if (heading.getBoundingClientRect().right > phone.left) {
			throw new Error('The headline runs under the Plan.')
		}
	}, composition)
	const shot = await page.screenshot()
	await sharp(shot)
		.resize(width, height, { kernel: 'lanczos3' })
		.flatten({ background: '#ffffff' })
		.png({ palette: true, colours: 256, quality: 100, effort: 10 })
		.toFile(output)
	console.log(`Wrote ${output}`)
} finally {
	await browser.close()
}
