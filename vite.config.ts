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
					source.endsWith('apple-touch-icon.png')
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
			// it would be really nice to have this enabled in tests, but we'll have to
			// wait until https://github.com/remix-run/remix/issues/9871 is fixed
			isTest ? null : reactRouter(),
		],
		test: {
			include: ['./{app,server}/**/*.test.{ts,tsx}'],
			setupFiles: ['./tests/setup/setup-test-env.ts'],
			globalSetup: ['./tests/setup/global-setup.ts'],
			restoreMocks: true,
			server: {
				deps: {
					// Vite's module-runner mis-analyzes zod 3.25's `import * as z; export { z }`
					// namespace re-export and reports `z` missing. Forcing zod inline routes it
					// through Vite's transform pipeline, which handles the pattern correctly.
					// Conform packages must be inlined together — otherwise zod loads twice
					// (Vite-transformed for user code, native for conform), and `instanceof
					// ZodNever` checks inside zod's strip logic fail across the boundary,
					// causing "Expected never, received string" on any extra form field.
					inline: ['zod', '@conform-to/zod', '@conform-to/dom'],
				},
			},
			coverage: {
				include: ['app/**/*.{ts,tsx}'],
				all: true,
			},
		},
	}
})
