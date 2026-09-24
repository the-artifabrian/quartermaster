import { isIP } from 'node:net'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'
import { server } from '#tests/setup/mocks-setup.ts'
import {
	fetchPublicUrl,
	isPublicUrl,
	type ResolveHost,
} from './public-url.server.ts'

const PUBLIC_IP = '93.184.216.34'
const OTHER_PUBLIC_IP = '93.184.216.35'
const PUBLIC_IPV6 = '2606:4700::6810:84e5'

function resolverFor(records: Record<string, Array<string>>) {
	const lookups: Array<string> = []
	const resolveHost = async (hostname: string) => {
		lookups.push(hostname)
		const addresses = records[hostname]
		if (!addresses)
			throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
		return addresses.map((address) => ({ address }))
	}
	return { resolveHost, lookups }
}

type Visit = { address: string; host: string; path: string }

/**
 * Stands in for the network: records the address each request connects to
 * and the host it names. A request that carries a name instead of an address
 * is resolved again with the same DNS, as a real network stack would.
 */
function networkAnswering(
	resolveHost: ResolveHost,
	respond: (visit: Visit) => Response = () => HttpResponse.text('ok'),
) {
	const visits: Array<Visit> = []
	server.use(
		http.all('*', async ({ request }) => {
			const url = new URL(request.url)
			const name = url.hostname.replace(/^\[|\]$/g, '')
			const [first] = isIP(name) ? [{ address: name }] : await resolveHost(name)
			const visit = {
				address: first?.address ?? 'unresolved',
				host: request.headers.get('host') ?? url.host,
				path: url.pathname,
			}
			visits.push(visit)
			return respond(visit)
		}),
	)
	return visits
}

test('private and reserved address literals are refused in any spelling', async () => {
	const { resolveHost, lookups } = resolverFor({})
	for (const url of [
		'http://127.0.0.2/',
		'http://2130706433/',
		'http://0x7f.1/',
		'http://10.1.2.3/',
		'http://100.64.0.1/',
		'http://169.254.169.254/latest/meta-data',
		'http://172.16.0.1/',
		'http://192.168.1.1/',
		'http://0.0.0.0/',
		'http://[::1]/',
		'http://[::ffff:10.0.0.1]/',
		'http://[fdaa::3]/',
		'http://[fe80::1]/',
	]) {
		expect(await isPublicUrl(url, resolveHost), url).toBe(false)
	}
	expect(await isPublicUrl(`http://${PUBLIC_IP}/`, resolveHost)).toBe(true)
	expect(lookups).toEqual([])
})

test('internal names are refused without a lookup', async () => {
	const { resolveHost, lookups } = resolverFor({})
	for (const url of [
		'http://localhost:3000/',
		'http://app.localhost/',
		'http://printer.local/',
		'http://quartermaster.internal/',
		'http://_api.internal:4280/',
		'http://intranet/',
	]) {
		expect(await isPublicUrl(url, resolveHost), url).toBe(false)
	}
	expect(lookups).toEqual([])
})

test('a name is public only when every address it resolves to is public', async () => {
	const { resolveHost } = resolverFor({
		'recipes.example': [PUBLIC_IP],
		'mixed.example': [PUBLIC_IP, '10.0.0.5'],
		'six.example': ['fdaa::5'],
		// NAT64 (DNS64) answers carry an IPv4 address in the last 32 bits.
		'nat64.example': [PUBLIC_IP, '64:ff9b::5db8:d822'],
		'nat64-private.example': ['64:ff9b::a00:5'],
	})

	expect(await isPublicUrl('https://recipes.example/soup', resolveHost)).toBe(
		true,
	)
	expect(await isPublicUrl('https://nat64.example/', resolveHost)).toBe(true)
	expect(await isPublicUrl('https://mixed.example/', resolveHost)).toBe(false)
	expect(await isPublicUrl('https://six.example/', resolveHost)).toBe(false)
	expect(await isPublicUrl('https://nat64-private.example/', resolveHost)).toBe(
		false,
	)
	expect(await isPublicUrl('https://missing.example/', resolveHost)).toBe(false)
})

test('only http and https URLs are allowed', async () => {
	const { resolveHost } = resolverFor({ 'recipes.example': [PUBLIC_IP] })
	for (const url of [
		'file:///etc/passwd',
		'ftp://recipes.example/',
		'data:text/html,hi',
		'not a url',
	]) {
		expect(await isPublicUrl(url, resolveHost), url).toBe(false)
	}
})

test('a redirect to an internal address is refused before it is requested', async () => {
	const { resolveHost } = resolverFor({ 'recipes.example': [PUBLIC_IP] })
	const visits = networkAnswering(resolveHost, () =>
		HttpResponse.redirect('http://10.0.0.5/secret', 302),
	)

	expect(
		await fetchPublicUrl('https://recipes.example/moved', {}, { resolveHost }),
	).toBeNull()
	expect(visits).toEqual([
		{ address: PUBLIC_IP, host: 'recipes.example', path: '/moved' },
	])
})

test('public redirects are followed one checked hop at a time', async () => {
	const { resolveHost, lookups } = resolverFor({
		'recipes.example': [PUBLIC_IP],
		'www.recipes.example': [OTHER_PUBLIC_IP],
	})
	const visits = networkAnswering(resolveHost, ({ host, path }) => {
		if (host === 'recipes.example') {
			return HttpResponse.redirect('https://www.recipes.example/soup', 301)
		}
		if (path === '/soup') {
			return new HttpResponse(null, {
				status: 308,
				headers: { Location: '/recipes/soup' },
			})
		}
		return HttpResponse.text('<h1>Soup</h1>')
	})

	const response = await fetchPublicUrl(
		'https://recipes.example/soup',
		{},
		{ resolveHost },
	)

	expect(await response?.text()).toBe('<h1>Soup</h1>')
	expect(response?.url).toBe('https://www.recipes.example/recipes/soup')
	expect(lookups).toEqual([
		'recipes.example',
		'www.recipes.example',
		'www.recipes.example',
	])
	expect(visits).toEqual([
		{ address: PUBLIC_IP, host: 'recipes.example', path: '/soup' },
		{ address: OTHER_PUBLIC_IP, host: 'www.recipes.example', path: '/soup' },
		{
			address: OTHER_PUBLIC_IP,
			host: 'www.recipes.example',
			path: '/recipes/soup',
		},
	])
})

test('a redirect loop stops instead of following forever', async () => {
	const { resolveHost } = resolverFor({ 'recipes.example': [PUBLIC_IP] })
	const visits = networkAnswering(resolveHost, () =>
		HttpResponse.redirect('https://recipes.example/loop', 302),
	)

	expect(
		await fetchPublicUrl(
			'https://recipes.example/loop',
			{},
			{ resolveHost, maxRedirects: 3 },
		),
	).toBeNull()
	expect(visits).toHaveLength(4)
})

test('the request connects to the address that was checked, even when DNS later answers differently', async () => {
	// A hostile DNS server answers with a public address for the check and a
	// private one for every lookup after it (DNS rebinding).
	const answers = [PUBLIC_IP]
	const lookups: Array<string> = []
	const resolveHost = async (hostname: string) => {
		lookups.push(hostname)
		return [{ address: answers.shift() ?? '10.0.0.5' }]
	}
	const visits = networkAnswering(resolveHost, () =>
		HttpResponse.text('<h1>Soup</h1>'),
	)

	const response = await fetchPublicUrl(
		'https://rebind.example/soup',
		{},
		{ resolveHost },
	)

	expect(await response?.text()).toBe('<h1>Soup</h1>')
	expect(visits).toEqual([
		{ address: PUBLIC_IP, host: 'rebind.example', path: '/soup' },
	])
	expect(lookups).toEqual(['rebind.example'])
})

test('the pinned request names the original host for Host, SNI and the certificate check', async () => {
	const { resolveHost } = resolverFor({ 'recipes.example': [PUBLIC_IP] })
	const visits = networkAnswering(resolveHost)
	const fetchSpy = vi.spyOn(globalThis, 'fetch')

	const response = await fetchPublicUrl(
		'https://recipes.example:8443/soup?serves=2',
		{},
		{ resolveHost },
	)

	expect(visits).toEqual([
		{ address: PUBLIC_IP, host: 'recipes.example:8443', path: '/soup' },
	])
	// Bun sends tls.serverName as SNI and verifies the certificate against
	// it. Nothing else in tls, so verification can never be switched off.
	expect(Reflect.get(fetchSpy.mock.calls[0]?.[1] ?? {}, 'tls')).toEqual({
		serverName: 'recipes.example',
	})
	expect(response?.url).toBe('https://recipes.example:8443/soup?serves=2')
})

test('several addresses are tried in turn, IPv4 first, and only those checked', async () => {
	const { resolveHost } = resolverFor({
		'recipes.example': [PUBLIC_IPV6, PUBLIC_IP, OTHER_PUBLIC_IP],
	})
	const visits = networkAnswering(resolveHost, ({ address }) =>
		address === PUBLIC_IPV6
			? HttpResponse.text('<h1>Soup</h1>')
			: HttpResponse.error(),
	)

	const response = await fetchPublicUrl(
		'https://recipes.example/soup',
		{},
		{ resolveHost },
	)

	expect(await response?.text()).toBe('<h1>Soup</h1>')
	expect(visits).toEqual([
		{ address: PUBLIC_IP, host: 'recipes.example', path: '/soup' },
		{ address: OTHER_PUBLIC_IP, host: 'recipes.example', path: '/soup' },
		{ address: PUBLIC_IPV6, host: 'recipes.example', path: '/soup' },
	])
})

test("the caller's abort signal still stops a pinned request", async () => {
	const { resolveHost } = resolverFor({
		'recipes.example': [PUBLIC_IP, OTHER_PUBLIC_IP],
	})
	const visits = networkAnswering(resolveHost)

	await expect(
		fetchPublicUrl(
			'https://recipes.example/soup',
			{ signal: AbortSignal.abort() },
			{ resolveHost },
		),
	).rejects.toMatchObject({ name: 'AbortError' })
	expect(visits).toEqual([])
})
