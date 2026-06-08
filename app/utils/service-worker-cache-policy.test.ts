import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, test } from 'vitest'

/**
 * These tests exercise the cache-routing predicates that decide whether a request
 * is cached at all (`isCacheablePage`) and whether it may be served stale
 * (`isReadMostly`). They are the security-/correctness-relevant gates in the
 * service worker: a regression here can silently re-introduce a cross-household
 * data-leak (wrong route cached) or break the SWR fast path.
 *
 * Rather than duplicate the predicates (a copy would drift from the shipped code),
 * we load the REAL public/sw.js into a sandbox and call its actual functions. The
 * SW is a classic worker script (no exports), so we evaluate it with stubbed
 * worker globals and capture the two pure predicates off `self`.
 */
function loadServiceWorkerPredicates() {
	const swPath = fileURLToPath(new URL('../../public/sw.js', import.meta.url))
	const source = readFileSync(swPath, 'utf8')

	// The script only *registers* event handlers at load time (it never invokes
	// them), so a no-op addEventListener is all that's needed to evaluate it.
	const sandbox: Record<string, any> = {
		self: { addEventListener: () => {} },
		// URL/Set/String are ECMAScript intrinsics already present in a vm context;
		// no Web APIs are touched until a handler runs, which we never trigger here.
	}
	vm.createContext(sandbox)
	// Append a probe that captures the predicates we want to test. They are
	// top-level function declarations in sw.js, so they're in scope here.
	vm.runInContext(
		`${source}\n;self.__test = { isCacheablePage, isReadMostly };`,
		sandbox,
	)

	const captured = sandbox.self.__test as {
		isCacheablePage: (url: URL) => boolean
		isReadMostly: (url: URL) => boolean
	}
	expect(typeof captured?.isCacheablePage).toBe('function')
	expect(typeof captured?.isReadMostly).toBe('function')
	return captured
}

const { isCacheablePage, isReadMostly } = loadServiceWorkerPredicates()
const url = (pathname: string) => new URL(`https://quartermaster.test${pathname}`)

describe('isCacheablePage', () => {
	test.each([
		// list/detail/plan/shopping pages (and their RR7 .data variants) are cached
		['/recipes', true],
		['/recipes.data', true],
		['/plan', true],
		['/plan.data', true],
		['/shopping', true],
		['/shopping.data', true],
		['/recipes/abc123', true],
		['/recipes/abc123.data', true],
		// recipe form sub-routes must NOT be cached (they need the network)
		['/recipes/new', false],
		['/recipes/new.data', false],
		['/recipes/import', false],
		['/recipes/generate', false],
		['/recipes/quick', false],
		['/recipes/bulk-import', false],
		// edit and deeper sub-paths are not the cacheable detail page
		['/recipes/abc123/edit', false],
		['/recipes/abc123/edit.data', false],
		// unrelated authenticated routes are not cached here
		['/inventory', false],
		['/inventory.data', false],
		['/', false],
		['/login', false],
		['/settings/profile', false],
	])('%s → %s', (pathname, expected) => {
		expect(isCacheablePage(url(pathname))).toBe(expected)
	})
})

describe('isReadMostly', () => {
	test.each([
		// read-mostly routes may be served stale-while-revalidate
		['/recipes', true],
		['/recipes.data', true],
		['/recipes/abc123', true],
		['/recipes/abc123.data', true],
		['/plan', true],
		['/plan.data', true],
		// shopping is edited daily → must stay network-first, never stale
		['/shopping', false],
		['/shopping.data', false],
	])('%s → %s', (pathname, expected) => {
		expect(isReadMostly(url(pathname))).toBe(expected)
	})

	test('every shopping request is excluded from the stale-serve path', () => {
		expect(isReadMostly(url('/shopping'))).toBe(false)
		expect(isReadMostly(url('/shopping.data'))).toBe(false)
	})
})
