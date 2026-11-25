import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { envOnlyMacros } from 'vite-env-only'
import { iconsSpritesheet } from 'vite-plugin-icons-spritesheet'

export default defineConfig((config) => {
	const mode = config.mode ?? process.env.NODE_ENV
	const isTest = mode === 'test' || Boolean(process.env.VITEST)
	return {
		build: {
			target: 'es2022',
			cssMinify: mode === 'production',
			manifest: true,

			rollupOptions: {
				external: [/node:.*/, 'fsevents'],
			},

			assetsInlineLimit: (source: string) => {
				if (
					source.endsWith('favicon.svg') ||
					source.endsWith('apple-touch-icon.png') ||
					// Link preview sites need a real URL, never a data: URL.
					source.endsWith('og-image.png')
				) {
					return false
				}
			},

			sourcemap: false,
		},
		server: {
			watch: {
				ignored: ['**/playwright-report/**'],
			},
		},
		environments: {
			// RR8's Vite Environment API build ignores the legacy
			// `config.isSsrBuild` signal, so the custom server entry must be
			// declared on the ssr environment directly.
			ssr: {
				build: {
					rollupOptions: {
						input: './server/app.ts',
					},
				},
			},
		},
		plugins: [
			envOnlyMacros(),
			tailwindcss(),

			iconsSpritesheet({
				inputDir: './other/svg-icons',
				outputDir: './app/components/ui/icons',
				fileName: 'sprite.svg',
				withTypes: true,
				iconNameTransformer: (name) => name,
			}),
			// Vitest runs without the React Router plugin; see
			// https://github.com/remix-run/remix/issues/9871.
			isTest ? null : reactRouter(),
		],
		test: {
			// tests/*.test.ts covers the test helpers themselves, such as
			// the e2e lock; the Playwright files under tests/e2e stay out.
			include: [
				'./{app,server,prisma}/**/*.test.{ts,tsx}',
				'./tests/*.test.ts',
			],
			setupFiles: ['./tests/setup/setup-test-env.ts'],
			globalSetup: ['./tests/setup/global-setup.ts'],
			restoreMocks: true,
			coverage: {
				include: ['app/**/*.{ts,tsx}'],
				all: true,
			},
		},
	}
})
