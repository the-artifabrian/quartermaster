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
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const origin = process.argv[2] ?? 'http://localhost:3000'
const output = 'app/assets/og-image.png'
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
		const heading = document.querySelector('h1')
		const hero = heading?.closest('section')
		const header = document.querySelector('header')
		if (!heading?.parentElement || !hero || !header) {
			throw new Error('The homepage hero has changed; update this script.')
		}
		for (const el of heading.parentElement.children) {
			if (el !== heading) (el as HTMLElement).style.display = 'none'
		}
		for (const link of header.querySelectorAll('a[href^="/login"]')) {
			;(link as HTMLElement).style.visibility = 'hidden'
		}
		heading.style.fontSize = '80px'
		heading.parentElement.style.alignSelf = 'center'
		// Centre the agenda in the space under the header.
		const agenda = hero.lastElementChild as HTMLElement
		const room = window.innerHeight - header.getBoundingClientRect().height
		const pad = Math.max(0, (room - agenda.getBoundingClientRect().height) / 2)
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
