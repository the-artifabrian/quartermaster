import path from 'node:path'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
// import { reactRouterDevTools } from 'react-router-devtools'
import { defineConfig } from 'vite'
import { envOnlyMacros } from 'vite-env-only'
import { iconsSpritesheet } from 'vite-plugin-icons-spritesheet'

export default defineConfig((config) => {
	const mode = config.mode ?? process.env.NODE_ENV
	const isTest = mode === 'test' || Boolean(process.env.VITEST)
	const cacheServerStubPlugin = {
		name: 'vitest-cache-server-stub',
		enforce: 'pre' as const,
		resolveId(source: string) {
			if (!process.env.VITEST) return null
			if (source.endsWith('cache.server.ts')) {
				return path.resolve('tests/mocks/cache-server.ts')
			}
			return null
		},
	}
	return {
		build: {
			target: 'es2022',
			cssMinify: mode === 'production',

			rollupOptions: {
				input: config.isSsrBuild ? './server/app.ts' : undefined,
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
		ssr: {
			noExternal: ['posthog-js', '@posthog/react'],
		},
		plugins: [
			cacheServerStubPlugin,
			envOnlyMacros(),
			tailwindcss(),
			// reactRouterDevTools(),

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
			include: ['./app/**/*.test.{ts,tsx}'],
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
