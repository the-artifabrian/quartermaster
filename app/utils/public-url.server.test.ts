import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'
import { server } from '#tests/setup/mocks-setup.ts'
import { fetchPublicUrl, isPublicUrl } from './public-url.server.ts'

const PUBLIC_IP = '93.184.216.34'

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
	const internalHits: Array<string> = []
	server.use(
		http.get('https://recipes.example/moved', () =>
			HttpResponse.redirect('http://10.0.0.5/secret', 302),
		),
		http.get('http://10.0.0.5/secret', ({ request }) => {
			internalHits.push(request.url)
			return HttpResponse.text('secret')
		}),
	)

	expect(
		await fetchPublicUrl('https://recipes.example/moved', {}, { resolveHost }),
	).toBeNull()
	expect(internalHits).toEqual([])
})

test('public redirects are followed one checked hop at a time', async () => {
	const { resolveHost, lookups } = resolverFor({
		'recipes.example': [PUBLIC_IP],
		'www.recipes.example': [PUBLIC_IP],
	})
	server.use(
		http.get('https://recipes.example/soup', () =>
			HttpResponse.redirect('https://www.recipes.example/soup', 301),
		),
		http.get(
			'https://www.recipes.example/soup',
			() =>
				new HttpResponse(null, {
					status: 308,
					headers: { Location: '/recipes/soup' },
				}),
		),
		http.get('https://www.recipes.example/recipes/soup', () =>
			HttpResponse.text('<h1>Soup</h1>'),
		),
	)

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
})

test('a redirect loop stops instead of following forever', async () => {
	const { resolveHost } = resolverFor({ 'recipes.example': [PUBLIC_IP] })
	let hops = 0
	server.use(
		http.get('https://recipes.example/loop', () => {
			hops++
			return HttpResponse.redirect('https://recipes.example/loop', 302)
		}),
	)

	expect(
		await fetchPublicUrl(
			'https://recipes.example/loop',
			{},
			{ resolveHost, maxRedirects: 3 },
		),
	).toBeNull()
	expect(hops).toBe(4)
})
