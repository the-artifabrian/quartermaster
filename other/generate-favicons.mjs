/**
 * Generate raster favicons from the recipe card icon.
 * Run: node other/generate-favicons.mjs
 */
import sharp from 'sharp'
import { execSync } from 'child_process'
import { mkdirSync } from 'fs'

// Shared recipe card on green background — used by all icon sizes
const makeAppIcon = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
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
</svg>`

// OG image SVG (1200x630) — uses same portrait card as app icon
const ogSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f0faf2"/>
      <stop offset="100%" stop-color="#d4edda"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- Recipe card icon — same as app icon, scaled to ~150px -->
  <g transform="translate(525, 50) scale(0.3)">
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
  </g>
  <!-- App name -->
  <text x="600" y="330" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="72" font-weight="700" fill="#1a3a22">Quartermaster</text>
  <!-- Tagline -->
  <text x="600" y="390" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="32" fill="#52a868">Your personal recipe manager</text>
  <!-- Subtle bottom border -->
  <rect x="0" y="618" width="1200" height="12" fill="#52a868"/>
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

	// .ico also uses the same green-bg design for consistency
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

	// OG image (1200x630)
	await sharp(Buffer.from(ogSvg))
		.resize(1200, 630)
		.png()
		.toFile('public/og-image.png')
	console.log('✓ og-image.png (1200x630)')

	console.log('\nDone! All icons generated.')
}

main().catch(console.error)
