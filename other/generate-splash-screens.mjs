/**
 * Generate iOS PWA startup images (apple-touch-startup-image) for all
 * current device sizes, in both light and dark themes.
 *
 * Run: node other/generate-splash-screens.mjs
 *
 * Output goes to public/splash/. These are committed to git so the build
 * doesn't need sharp at deploy time.
 */
import { mkdirSync } from 'fs'
import sharp from 'sharp'

// Every iOS screen size that needs a startup image.
// Portrait only — phones lock to portrait in standalone PWA mode.
// Source: https://developer.apple.com/design/human-interface-guidelines/layout
const screens = [
	// iPhone 16 Pro Max
	{ w: 440, h: 956, dpr: 3 },
	// iPhone 16 Pro
	{ w: 402, h: 874, dpr: 3 },
	// iPhone 16 Plus / 15 Plus / 14 Pro Max
	{ w: 430, h: 932, dpr: 3 },
	// iPhone 16 / 15 / 15 Pro / 14 Pro
	{ w: 393, h: 852, dpr: 3 },
	// iPhone 14 Plus / 13 Pro Max / 12 Pro Max
	{ w: 428, h: 926, dpr: 3 },
	// iPhone 14 / 13 / 13 Pro / 12 / 12 Pro
	{ w: 390, h: 844, dpr: 3 },
	// iPhone 13 mini / 12 mini
	{ w: 360, h: 780, dpr: 3 },
	// iPhone 11 Pro Max / XS Max
	{ w: 414, h: 896, dpr: 3 },
	// iPhone 11 / XR
	{ w: 414, h: 896, dpr: 2 },
	// iPhone 11 Pro / XS / X
	{ w: 375, h: 812, dpr: 3 },
	// iPhone SE 3rd/2nd / 8 / 7 / 6s
	{ w: 375, h: 667, dpr: 2 },
	// iPhone 8 Plus / 7 Plus
	{ w: 414, h: 736, dpr: 3 },
]

// Same recipe card icon used by favicons (from generate-favicons.mjs)
const appIconSvg = `
  <rect width="512" height="512" rx="80" fill="#52a868"/>
  <rect x="106" y="96" width="280" height="360" rx="20" fill="white"/>
  <rect x="141" y="136" width="180" height="20" rx="6" fill="#52a868"/>
  <rect x="141" y="176" width="210" height="4" rx="2" fill="#52a868" opacity="0.3"/>
  <circle cx="156" cy="216" r="8" fill="#52a868"/>
  <rect x="176" y="209" width="140" height="14" rx="4" fill="#52a868" opacity="0.5"/>
  <circle cx="156" cy="256" r="8" fill="#52a868"/>
  <rect x="176" y="249" width="160" height="14" rx="4" fill="#52a868" opacity="0.5"/>
  <circle cx="156" cy="296" r="8" fill="#52a868"/>
  <rect x="176" y="289" width="120" height="14" rx="4" fill="#52a868" opacity="0.5"/>
  <path d="M226 356 L246 381 L286 331" stroke="#52a868" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
`

const themes = {
	light: { bg: '#f8fdf9', fg: '#1a1a1a', accent: '#52a868' },
	dark: { bg: '#0a0a0a', fg: '#e5e5e5', accent: '#4ade80' },
}

function makeSplashSvg(pxW, pxH, theme) {
	const { bg, fg, accent } = themes[theme]
	const iconSize = Math.round(Math.min(pxW, pxH) * 0.18)
	const cx = pxW / 2
	const cy = pxH / 2 - iconSize * 0.3
	const fontSize = Math.round(iconSize * 0.35)

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">
  <rect width="${pxW}" height="${pxH}" fill="${bg}"/>
  <g transform="translate(${cx - iconSize / 2}, ${cy - iconSize / 2}) scale(${iconSize / 512})">
    ${appIconSvg}
  </g>
  <text x="${cx}" y="${cy + iconSize / 2 + fontSize * 1.2}"
    text-anchor="middle"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="${fontSize}" font-weight="600"
    fill="${fg}">Quartermaster</text>
</svg>`
}

const outDir = 'public/splash'
mkdirSync(outDir, { recursive: true })

async function main() {
	console.log('Generating iOS PWA startup images...\n')
	let count = 0

	for (const { w, h, dpr } of screens) {
		const pxW = w * dpr
		const pxH = h * dpr

		for (const theme of ['light', 'dark']) {
			const filename = `${theme}-${pxW}x${pxH}.png`
			const svg = makeSplashSvg(pxW, pxH, theme)
			await sharp(Buffer.from(svg)).png().toFile(`${outDir}/${filename}`)
			count++
			console.log(`  ✓ ${filename}`)
		}
	}

	console.log(`\nDone! ${count} images generated in ${outDir}/`)

	// Print the link tags for copy-pasting or reference
	console.log('\n--- Link tags for root.tsx ---\n')
	for (const { w, h, dpr } of screens) {
		const pxW = w * dpr
		const pxH = h * dpr
		for (const theme of ['light', 'dark']) {
			console.log(
				`<link rel="apple-touch-startup-image" href="/splash/${theme}-${pxW}x${pxH}.png" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (prefers-color-scheme: ${theme})" />`,
			)
		}
	}
}

main().catch(console.error)
