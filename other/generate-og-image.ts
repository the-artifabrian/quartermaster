/**
 * Render the link preview image (1200×630) from the homepage hero.
 *
 * Start the app first (a production build is what it was made against), then
 * run:
 *   bun other/generate-og-image.ts [origin]
 * The origin defaults to http://localhost:3000.
 *
 * It opens the real homepage and keeps the headline and the Plan agenda. The
 * subhead, the buttons and the header's Log in are hidden because nobody can
 * read or tap them in a preview card. The hero is laid out at 1280 CSS px wide,
 * shot at twice the output size and scaled down, so the text stays sharp.
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
// Wide enough for the two-column hero with the headline on three lines.
const layoutWidth = 1280

const browser = await chromium.launch()
try {
	const page = await browser.newPage({
		viewport: {
			width: layoutWidth,
			height: Math.round((layoutWidth * height) / width),
		},
		deviceScaleFactor: (2 * width) / layoutWidth,
	})
	await page.goto(origin)
	await page.evaluate(async () => {
		const changed = (what: string) =>
			new Error(`The homepage ${what} has changed; update this script.`)
		const heading = document.querySelector('h1')
		const hero = heading?.closest('section')
		const header = document.querySelector('header')
		if (!heading?.parentElement || !hero || !header) throw changed('hero')
		// The agenda is the hero's framed Plan, drawn as one image.
		const agenda = hero.querySelector<HTMLElement>(
			':scope > div > [role="img"]',
		)
		if (!agenda) throw changed('Plan agenda')
		const logIn = header.querySelectorAll<HTMLElement>('a[href^="/login"]')
		if (logIn.length === 0) throw changed('header Log in link')

		for (const el of heading.parentElement.children) {
			if (el !== heading) (el as HTMLElement).style.display = 'none'
		}
		for (const link of logIn) link.style.visibility = 'hidden'
		heading.style.fontSize = '80px'
		heading.parentElement.style.alignSelf = 'center'
		// Centre the agenda in the space under the header.
		const room = window.innerHeight - header.getBoundingClientRect().height
		const pad = (room - agenda.getBoundingClientRect().height) / 2
		if (pad <= 0) {
			throw new Error(
				'The Plan agenda is taller than the image; show fewer days or widen layoutWidth.',
			)
		}
		hero.style.paddingTop = `${pad}px`
		hero.style.paddingBottom = `${pad}px`
		hero.style.alignItems = 'center'
		document.documentElement.style.overflow = 'hidden'
		document.documentElement.style.scrollbarGutter = 'auto'
		await document.fonts.ready
		await Promise.all(
			[...document.images].map((img) => img.decode().catch(() => {})),
		)
	})
	const shot = await page.screenshot()
	await sharp(shot)
		.resize(width, height, { kernel: 'lanczos3' })
		.png({ palette: true, colours: 256, quality: 100, effort: 10 })
		.toFile(output)
	console.log(`Wrote ${output}`)
} finally {
	await browser.close()
}
