import { describe, expect, test, vi } from 'vitest'
import {
	createLoaderCache,
	loaderCache,
	staleWhileRevalidate,
} from './loader-cache.ts'

const ORIGIN = 'https://useqm.app'

function request(href: string, signal?: AbortSignal) {
	return new Request(`${ORIGIN}${href}`, { signal })
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function setup({ maxEntries }: { maxEntries?: number } = {}) {
	const cache = createLoaderCache({ maxEntries })
	cache.setIdentity('alex-home')
	return { cache }
}

/** Loads `href` from somewhere else, so the cache may answer. */
function navigate<T>(
	cache: ReturnType<typeof createLoaderCache>,
	href: string,
	serverLoader: () => Promise<T>,
	from = '/elsewhere',
) {
	cache.setLocation(from)
	return cache.load({ request: request(href), serverLoader })
}

/** Loads `href` while already on it, the way every revalidation does. */
function revalidate<T>(
	cache: ReturnType<typeof createLoaderCache>,
	href: string,
	serverLoader: () => Promise<T>,
	signal?: AbortSignal,
) {
	cache.setLocation(href)
	return cache.load({ request: request(href, signal), serverLoader })
}

describe('serving from the cache', () => {
	test('a navigation to a URL loaded before gets the stored data without asking the server', async () => {
		const { cache } = setup()
		const first = { meals: ['tacos'] }
		await navigate(cache, '/plan', async () => first)

		const server = vi.fn(async () => ({ meals: ['soup'] }))
		const served = await navigate(cache, '/plan', server)

		expect(served).toBe(first)
		expect(server).not.toHaveBeenCalled()
		expect(cache.takeServedFromCache(served)).toBe(true)
	})

	test('data fresh from the server is not marked as served from the cache', async () => {
		const { cache } = setup()
		const fresh = await navigate(cache, '/plan', async () => ({ meals: [] }))

		expect(cache.takeServedFromCache(fresh)).toBe(false)
	})

	test('the served-from-cache mark is taken once, so the page revalidates once', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: [] }))
		const served = await navigate(cache, '/plan', async () => ({ meals: [] }))

		expect(cache.takeServedFromCache(served)).toBe(true)
		expect(cache.takeServedFromCache(served)).toBe(false)
	})

	test('cached data is replaced by the fresh data of the revalidation behind it', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))
		await navigate(cache, '/plan', async () => ({ meals: ['unused'] }))

		const fresh = { meals: ['soup'] }
		expect(await revalidate(cache, '/plan', async () => fresh)).toBe(fresh)
		expect(await navigate(cache, '/plan', async () => ({}))).toBe(fresh)
	})

	test('a load of the current URL (after an action, a fetcher, pull to refresh) always asks the server', async () => {
		const { cache } = setup()
		await navigate(cache, '/shopping', async () => ({ items: ['milk'] }))

		const fresh = { items: ['milk', 'eggs'] }
		const server = vi.fn(async () => fresh)
		expect(await revalidate(cache, '/shopping', server)).toBe(fresh)
		expect(server).toHaveBeenCalledOnce()
	})

	test('the same path with a different search string is a different entry', async () => {
		const { cache } = setup()
		const thisWeek = { weekStart: '2026-10-05' }
		await navigate(cache, '/plan', async () => thisWeek)

		const nextWeek = { weekStart: '2026-10-12' }
		const server = vi.fn(async () => nextWeek)
		expect(await navigate(cache, '/plan?weekStart=2026-10-12', server)).toBe(
			nextWeek,
		)
		expect(server).toHaveBeenCalledOnce()
		expect(await navigate(cache, '/plan', async () => ({}))).toBe(thisWeek)
	})

	test('the server result is passed through unchanged, whatever its shape', async () => {
		const { cache } = setup()
		const streamed = { recipe: Promise.resolve('later'), when: new Date(0) }
		expect(await navigate(cache, '/recipes/r1', async () => streamed)).toBe(
			streamed,
		)
	})
})

describe('identity scoping', () => {
	test('without a known identity nothing is read or stored', async () => {
		const cache = createLoaderCache()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))

		const fresh = { meals: ['soup'] }
		expect(await navigate(cache, '/plan', async () => fresh)).toBe(fresh)
	})

	test('logout drops every entry', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))
		cache.setIdentity(null)
		cache.setIdentity('alex-home')

		const fresh = { meals: ['soup'] }
		expect(await navigate(cache, '/plan', async () => fresh)).toBe(fresh)
	})

	test("another household's data is never served after a household change", async () => {
		const { cache } = setup()
		await navigate(cache, '/recipes', async () => ({ household: 'home' }))
		cache.setIdentity('alex-cabin')

		const cabin = { household: 'cabin' }
		expect(await navigate(cache, '/recipes', async () => cabin)).toBe(cabin)
		// Switching back does not resurrect the first household's entries either.
		cache.setIdentity('alex-home')
		const home = { household: 'home again' }
		expect(await navigate(cache, '/recipes', async () => home)).toBe(home)
	})

	test('a response that lands after the identity changed is not stored for anyone', async () => {
		const { cache } = setup()
		const pending = deferred<{ household: string }>()
		const load = navigate(cache, '/inventory', () => pending.promise)
		cache.setIdentity('sam-home')
		pending.resolve({ household: 'alex' })
		await load

		const fresh = { household: 'sam' }
		expect(await navigate(cache, '/inventory', async () => fresh)).toBe(fresh)
	})

	test('re-announcing the same identity keeps the entries', async () => {
		const { cache } = setup()
		const first = { meals: ['tacos'] }
		await navigate(cache, '/plan', async () => first)
		cache.setIdentity('alex-home')

		expect(await navigate(cache, '/plan', async () => ({}))).toBe(first)
	})
})

describe('clearing after a mutation', () => {
	test('clear drops every entry', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))
		await navigate(cache, '/shopping', async () => ({ items: ['milk'] }))
		cache.clear()

		const plan = { meals: ['soup'] }
		const shopping = { items: [] }
		expect(await navigate(cache, '/plan', async () => plan)).toBe(plan)
		expect(await navigate(cache, '/shopping', async () => shopping)).toBe(
			shopping,
		)
	})

	test('a response that started before the clear is not stored after it', async () => {
		const { cache } = setup()
		const pending = deferred<{ items: string[] }>()
		const load = navigate(cache, '/shopping', () => pending.promise)
		cache.clear()
		pending.resolve({ items: ['before the write'] })
		await load

		const fresh = { items: ['after the write'] }
		expect(await navigate(cache, '/shopping', async () => fresh)).toBe(fresh)
	})
})

describe('size cap', () => {
	test('the least recently used entry is evicted past the cap', async () => {
		const { cache } = setup({ maxEntries: 2 })
		const a = { page: 'a' }
		await navigate(cache, '/a', async () => a)
		await navigate(cache, '/b', async () => ({ page: 'b' }))
		// Reading /a makes /b the least recently used.
		await navigate(cache, '/a', async () => ({}))
		await navigate(cache, '/c', async () => ({ page: 'c' }))

		expect(await navigate(cache, '/a', async () => ({}))).toBe(a)
		const b = { page: 'b again' }
		expect(await navigate(cache, '/b', async () => b)).toBe(b)
	})

	test('the default cap holds 32 entries', async () => {
		const { cache } = setup()
		const first = { page: 0 }
		await navigate(cache, '/recipes/0', async () => first)
		for (let i = 1; i < 32; i++) {
			await navigate(cache, `/recipes/${i}`, async () => ({ page: i }))
		}
		expect(await navigate(cache, '/recipes/0', async () => ({}))).toBe(first)

		await navigate(cache, '/recipes/32', async () => ({ page: 32 }))
		await navigate(cache, '/recipes/33', async () => ({ page: 33 }))
		const fresh = { page: '1 again' }
		expect(await navigate(cache, '/recipes/1', async () => fresh)).toBe(fresh)
	})
})

describe('server errors', () => {
	test('a redirect on the revalidation of a cached URL wins and leaves no stale entry', async () => {
		const { cache } = setup()
		await navigate(cache, '/recipes/r1', async () => ({ title: 'Soup' }))

		const redirect = new Response(null, {
			status: 302,
			headers: { Location: '/login' },
		})
		await expect(
			revalidate(cache, '/recipes/r1', () => Promise.reject(redirect)),
		).rejects.toBe(redirect)

		const server = vi.fn(async () => ({ title: 'Gone' }))
		await navigate(cache, '/recipes/r1', server)
		expect(server).toHaveBeenCalledOnce()
	})

	test('a 404 on the revalidation of a cached URL wins and leaves no stale entry', async () => {
		const { cache } = setup()
		await navigate(cache, '/recipes/r1', async () => ({ title: 'Soup' }))

		const notFound = {
			status: 404,
			statusText: 'Not Found',
			data: 'Recipe not found',
			internal: false,
		}
		await expect(
			revalidate(cache, '/recipes/r1', () => Promise.reject(notFound)),
		).rejects.toBe(notFound)

		const server = vi.fn(async () => ({}))
		await navigate(cache, '/recipes/r1', server)
		expect(server).toHaveBeenCalledOnce()
	})

	test('a failed revalidation goes to the error path and the next navigation asks the server', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))

		const failure = new TypeError('Load failed')
		await expect(
			revalidate(cache, '/plan', () => Promise.reject(failure)),
		).rejects.toBe(failure)

		const next = vi.fn(() => Promise.reject(failure))
		await expect(navigate(cache, '/plan', next)).rejects.toBe(failure)
		expect(next).toHaveBeenCalledOnce()
	})

	test('an error on a navigation that missed the cache is thrown and nothing is stored', async () => {
		const { cache } = setup()
		const failure = new Error('database is locked')
		await expect(
			navigate(cache, '/plan', () => Promise.reject(failure)),
		).rejects.toBe(failure)

		const fresh = { meals: [] }
		expect(await navigate(cache, '/plan', async () => fresh)).toBe(fresh)
	})

	test('a revalidation aborted by a navigation keeps the entry', async () => {
		const { cache } = setup()
		const cached = { meals: ['tacos'] }
		await navigate(cache, '/plan', async () => cached)

		const controller = new AbortController()
		const pending = deferred<never>()
		const load = revalidate(
			cache,
			'/plan',
			() => pending.promise,
			controller.signal,
		)
		const abort = new DOMException('aborted', 'AbortError')
		controller.abort(abort)
		pending.reject(abort)
		await expect(load).rejects.toBe(abort)

		expect(await navigate(cache, '/plan', async () => ({}))).toBe(cached)
	})
})

describe('overlapping loads', () => {
	test('a navigation while a revalidation is in flight is served from the cache, and the revalidation still refills its own entry', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))
		const shopping = { items: ['milk'] }
		await navigate(cache, '/shopping', async () => shopping)

		const pending = deferred<{ meals: string[] }>()
		const inFlight = revalidate(cache, '/plan', () => pending.promise)
		const server = vi.fn(async () => ({ items: [] }))
		expect(await navigate(cache, '/shopping', server, '/plan')).toBe(shopping)
		expect(server).not.toHaveBeenCalled()

		const fresh = { meals: ['soup'] }
		pending.resolve(fresh)
		await inFlight
		expect(await navigate(cache, '/plan', async () => ({}))).toBe(fresh)
	})

	test('an older response landing after a newer one for the same URL does not overwrite it', async () => {
		const { cache } = setup()
		const older = deferred<{ meals: string[] }>()
		const newer = { meals: ['newer'] }
		const first = revalidate(cache, '/plan', () => older.promise)
		await revalidate(cache, '/plan', async () => newer)
		older.resolve({ meals: ['older'] })
		await first

		expect(await navigate(cache, '/plan', async () => ({}))).toBe(newer)
	})
})

describe('remembering the first page', () => {
	test('server-rendered data is remembered, so the next visit to it is instant', async () => {
		const { cache } = setup()
		const hydrated = { meals: ['tacos'] }
		cache.remember('/plan', hydrated)

		const server = vi.fn(async () => ({}))
		expect(await navigate(cache, '/plan', server)).toBe(hydrated)
		expect(server).not.toHaveBeenCalled()
	})

	test('remembering does not replace an entry a load stored', async () => {
		const { cache } = setup()
		const loaded = { meals: ['soup'] }
		await navigate(cache, '/plan', async () => loaded)
		cache.remember('/plan', { meals: ['older render'] })

		expect(await navigate(cache, '/plan', async () => ({}))).toBe(loaded)
	})

	test('a response a clear refused is not stored by remembering it', async () => {
		const { cache } = setup()
		const pending = deferred<{ items: string[] }>()
		const load = navigate(cache, '/shopping', () => pending.promise)
		cache.clear()
		pending.resolve({ items: ['before the write'] })
		cache.remember('/shopping', await load)

		const fresh = { items: ['after the write'] }
		expect(await navigate(cache, '/shopping', async () => fresh)).toBe(fresh)
	})

	test('nothing is remembered without a known identity', async () => {
		const cache = createLoaderCache()
		cache.remember('/plan', { meals: ['tacos'] })
		cache.setIdentity('alex-home')

		const fresh = { meals: [] }
		expect(await navigate(cache, '/plan', async () => fresh)).toBe(fresh)
	})
})

describe('the committed location', () => {
	test('back and forward to a cached page are served from the cache, though window.location already shows the target', async () => {
		using _singleton = {
			[Symbol.dispose]() {
				loaderCache.setIdentity(null)
				loaderCache.setLocation(null)
				vi.unstubAllGlobals()
			},
		}
		loaderCache.setIdentity('alex-home')
		loaderCache.setLocation('/shopping')
		const plan = { meals: ['tacos'] }
		await staleWhileRevalidate({
			request: request('/plan'),
			serverLoader: async () => plan,
		})
		// The user went on to Shopping, then pressed Back: the browser already
		// shows /plan while the router is still on /shopping.
		loaderCache.setLocation('/shopping')
		vi.stubGlobal('window', { location: { pathname: '/plan', search: '' } })

		const server = vi.fn(async () => ({ meals: [] }))
		expect(
			await staleWhileRevalidate({
				request: request('/plan'),
				serverLoader: server,
			}),
		).toBe(plan)
		expect(server).not.toHaveBeenCalled()
	})

	test('before the first commit every load asks the server', async () => {
		const { cache } = setup()
		await navigate(cache, '/plan', async () => ({ meals: ['tacos'] }))
		cache.setLocation(null)

		const fresh = { meals: [] }
		expect(
			await cache.load({
				request: request('/plan'),
				serverLoader: async () => fresh,
			}),
		).toBe(fresh)
	})
})
