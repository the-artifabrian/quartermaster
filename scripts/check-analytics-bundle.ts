import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type ManifestChunk = {
	file: string
	src?: string
	imports?: string[]
	dynamicImports?: string[]
}

const manifestPath = resolve('build/client/.vite/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
	string,
	ManifestChunk
>

function findModule(sourcePath: string) {
	const matches = Object.entries(manifest).filter(
		([key, chunk]) =>
			key.split('?')[0]?.endsWith(sourcePath) ||
			chunk.src?.split('?')[0]?.endsWith(sourcePath),
	)
	if (matches.length !== 1) {
		throw new Error(
			`Expected one ${sourcePath} module in ${manifestPath}; found ${matches.length}`,
		)
	}
	return matches[0]![0]
}

function collectStaticImports(entryModules: string[]) {
	const seen = new Set<string>()
	const pending = [...entryModules]

	while (pending.length) {
		const module = pending.pop()!
		if (seen.has(module)) continue
		seen.add(module)
		pending.push(...(manifest[module]?.imports ?? []))
	}

	return seen
}

const entryModule = findModule('app/entry.client.tsx')
const rootModule = findModule('app/root.tsx')
const posthogModule = findModule('app/utils/posthog.client.ts')
const hydrationGraph = collectStaticImports([entryModule, rootModule])

if (hydrationGraph.has(posthogModule)) {
	throw new Error(
		`Analytics SDK chunk ${manifest[posthogModule]!.file} is statically reachable from the hydration entry graph`,
	)
}

const dynamicImports = new Set(
	[...hydrationGraph].flatMap(
		(module) => manifest[module]?.dynamicImports ?? [],
	),
)
if (!dynamicImports.has(posthogModule)) {
	throw new Error(
		`Analytics SDK chunk ${manifest[posthogModule]!.file} is not an idle-loadable dynamic import of the root graph`,
	)
}

console.info(
	`✓ Analytics SDK is isolated in ${manifest[posthogModule]!.file} outside the hydration entry graph`,
)
