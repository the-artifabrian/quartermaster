/**
 * Generate raster favicons from the recipe card icon.
 * Run: bun other/generate-favicons.mjs
 */
import { execSync } from 'child_process'
import { mkdirSync } from 'fs'
import sharp from 'sharp'

// Sage, the app's primary colour in the light theme (--primary in
// app/styles/tailwind.css). favicon.svg uses it too, plus a dark-tab variant.
const SAGE = '#48724e'

// Shared recipe card on a sage background, used by all icon sizes
const makeAppIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="${SAGE}"/>
  <rect x="106" y="96" width="280" height="360" rx="20" fill="white"/>
  <rect x="141" y="136" width="180" height="20" rx="6" fill="${SAGE}"/>
  <rect x="141" y="176" width="210" height="4" rx="2" fill="${SAGE}" opacity="0.3"/>
  <circle cx="156" cy="216" r="8" fill="${SAGE}"/>
  <rect x="176" y="209" width="140" height="14" rx="4" fill="${SAGE}" opacity="0.5"/>
  <circle cx="156" cy="256" r="8" fill="${SAGE}"/>
  <rect x="176" y="249" width="160" height="14" rx="4" fill="${SAGE}" opacity="0.5"/>
  <circle cx="156" cy="296" r="8" fill="${SAGE}"/>
  <rect x="176" y="289" width="120" height="14" rx="4" fill="${SAGE}" opacity="0.5"/>
  <path d="M226 356 L246 381 L286 331" stroke="${SAGE}" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

// Maskable icons are cropped into platform-selected shapes. Keep the recipe
// card inside the central 80% safe circle and let only the sage background
// extend to the image edges.
const makeMaskableAppIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${SAGE}"/>
  <g transform="translate(76.8 76.8) scale(0.7)">
    <rect x="106" y="96" width="280" height="360" rx="20" fill="white"/>
    <rect x="141" y="136" width="180" height="20" rx="6" fill="${SAGE}"/>
    <rect x="141" y="176" width="210" height="4" rx="2" fill="${SAGE}" opacity="0.3"/>
    <circle cx="156" cy="216" r="8" fill="${SAGE}"/>
    <rect x="176" y="209" width="140" height="14" rx="4" fill="${SAGE}" opacity="0.5"/>
    <circle cx="156" cy="256" r="8" fill="${SAGE}"/>
    <rect x="176" y="249" width="160" height="14" rx="4" fill="${SAGE}" opacity="0.5"/>
    <circle cx="156" cy="296" r="8" fill="${SAGE}"/>
    <rect x="176" y="289" width="120" height="14" rx="4" fill="${SAGE}" opacity="0.5"/>
    <path d="M226 356 L246 381 L286 331" stroke="${SAGE}" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`

const tmpDir = '/tmp/quartermaster-favicons'
mkdirSync(tmpDir, { recursive: true })

async function main() {
	console.log('Generating favicons...')

	// Apple touch icon (180x180)
	await sharp(Buffer.from(makeAppIcon(512)))
		.resize(180, 180)
		.png()
		.toFile('app/assets/favicons/apple-touch-icon.png')
	console.log('✓ apple-touch-icon.png (180x180)')

	// Android Chrome icons
	await sharp(Buffer.from(makeAppIcon(512)))
		.resize(192, 192)
		.png()
		.toFile('public/favicons/android-chrome-192x192.png')
	console.log('✓ android-chrome-192x192.png')

	await sharp(Buffer.from(makeAppIcon(512)))
		.resize(512, 512)
		.png()
		.toFile('public/favicons/android-chrome-512x512.png')
	console.log('✓ android-chrome-512x512.png')

	await sharp(Buffer.from(makeMaskableAppIcon(512)))
		.resize(512, 512)
		.png()
		.toFile('public/favicons/maskable-icon-512x512.png')
	console.log('✓ maskable-icon-512x512.png')

	// .ico also uses the same sage design for consistency
	const icoSizes = [16, 32, 48]
	for (const size of icoSizes) {
		await sharp(Buffer.from(makeAppIcon(512)))
			.resize(size, size)
			.png()
			.toFile(`${tmpDir}/favicon-${size}.png`)
	}

	// Use ImageMagick to create .ico
	execSync(
		`magick ${tmpDir}/favicon-16.png ${tmpDir}/favicon-32.png ${tmpDir}/favicon-48.png public/favicon.ico`,
	)
	console.log('✓ favicon.ico (16x16, 32x32, 48x48)')

	console.log('\nDone! All icons generated.')
}

main().catch(console.error)
