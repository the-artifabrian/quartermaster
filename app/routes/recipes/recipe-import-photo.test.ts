import fs from 'node:fs/promises'
import path from 'node:path'
import { http, HttpResponse } from 'msw'
import { RouterContextProvider } from 'react-router'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { ACCEPT_ENCODING } from '#app/utils/bounded-body.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	MAX_WAITING_PHOTO_JOBS,
	withPhotoSlot,
} from '#app/utils/recipe-photo.server.ts'
import { MAX_RECIPE_IMAGE_SIZE } from '#app/utils/recipe-validation.ts'
import type * as Storage from '#app/utils/storage.server.ts'
import type * as Dns from 'node:dns/promises'
import { createUser } from '#tests/db-utils.ts'
import { server } from '#tests/setup/mocks-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as importAction } from './import.tsx'
import '#tests/setup/db-setup.ts'

// The hosts here are fictional, so they resolve to one public address and
// their pages and photos are mocked there. One host's nameserver never
// answers.
const slowLookup = vi.hoisted(() => ({ started: () => {} }))
vi.mock('node:dns/promises', async (importOriginal) => ({
	...(await importOriginal<typeof Dns>()),
	lookup: async (hostname: string) => {
		if (hostname !== 'slow-dns.example.test') {
			return [{ address: '93.184.216.34', family: 4 }]
		}
		slowLookup.started()
		return new Promise(() => {})
	},
}))
const CHECKED_ORIGIN = 'https://93.184.216.34'
const SITE = 'https://recipes.example.test'

// A test can run something right after a photo reaches storage, before it is
// attached to its Recipe.
const storage = vi.hoisted(() => ({
	afterUpload: null as null | ((recipeId: string) => Promise<void>),
}))
vi.mock('#app/utils/storage.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof Storage>()
	return {
		...real,
		uploadRecipeImage: async (
			...args: Parameters<typeof real.uploadRecipeImage>
		) => {
			const key = await real.uploadRecipeImage(...args)
			await storage.afterUpload?.(args[1])
			return key
		},
	}
})

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const uploadedFor = new Set<string>()
afterEach(async () => {
	storage.afterUpload = null
	for (const userId of uploadedFor) {
		await fs.rm(path.join(UPLOADS_DIR, 'users', userId), {
			recursive: true,
			force: true,
		})
	}
	uploadedFor.clear()
})

/** Every file stored under the user's folder. */
async function storedFiles(userId: string) {
	const dir = path.join(UPLOADS_DIR, 'users', userId)
	const entries = await fs
		.readdir(dir, { recursive: true, withFileTypes: true })
		.catch(() => [])
	return entries.filter((entry) => entry.isFile())
}

async function cook({ demo = false }: { demo?: boolean } = {}) {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: {
				create: {
					...createUser(),
					demoExpiresAt: demo ? new Date(Date.now() + 3_600_000) : null,
				},
			},
		},
	})
	const household = await prisma.household.create({
		data: {
			name: 'Photo import household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	uploadedFor.add(session.userId)
	return { ...session, householdId: household.id }
}

async function jpeg(width = 40, height = 30) {
	return new Uint8Array(
		await sharp({
			create: { width, height, channels: 3, background: '#c86b3c' },
		})
			.jpeg()
			.toBuffer(),
	)
}

function photoResponse(bytes: Uint8Array, type = 'image/jpeg') {
	return new HttpResponse(bytes, { headers: { 'Content-Type': type } })
}

/** A Recipe page at `/stew` whose JSON-LD names `image`. */
function servePage(image: unknown) {
	server.use(
		http.get(`${CHECKED_ORIGIN}/stew`, () =>
			HttpResponse.html(
				`<script type="application/ld+json">${JSON.stringify({
					'@type': 'Recipe',
					name: 'Lentil stew',
					image,
					recipeIngredient: ['200 g lentils'],
					recipeInstructions: ['Simmer until soft.'],
				})}</script>`,
			),
		),
	)
}

/** Imports `/stew` and returns the saved Recipe's id and its redirect. */
async function importStew(session: { id: string }) {
	const url = `${BASE_URL}/recipes/import`
	const response = await importAction({
		params: {},
		context: new RouterContextProvider(),
		pattern: '/recipes/import',
		url: new URL(url),
		request: new Request(url, {
			method: 'POST',
			headers: { cookie: await getSessionCookieHeader(session) },
			body: new URLSearchParams({ intent: 'fetch', url: `${SITE}/stew` }),
		}),
	})
	expect(response).toBeInstanceOf(Response)
	const location = new URL(
		(response as Response).headers.get('location')!,
		BASE_URL,
	)
	expect(location.pathname).toMatch(/^\/recipes\/[a-z0-9]+$/)
	return {
		id: location.pathname.split('/').at(-1)!,
		search: location.search,
	}
}

async function storedPhoto(recipeId: string) {
	const image = await prisma.recipeImage.findUnique({ where: { recipeId } })
	if (!image) return null
	return new Uint8Array(
		await fs.readFile(path.join(UPLOADS_DIR, image.objectKey)),
	)
}

test('a URL import brings the photo its JSON-LD names, stored like an upload, with the same notice', async () => {
	const session = await cook()
	const photo = await jpeg()
	servePage({ '@type': 'ImageObject', url: `${SITE}/stew.jpg` })
	server.use(http.get(`${CHECKED_ORIGIN}/stew.jpg`, () => photoResponse(photo)))

	const { id, search } = await importStew(session)

	expect(search).toBe('?imported=url')
	expect(await storedPhoto(id)).toEqual(photo)
	const { objectKey } = await prisma.recipeImage.findUniqueOrThrow({
		where: { recipeId: id },
	})
	expect(objectKey).toMatch(
		new RegExp(`^users/${session.userId}/recipes/${id}/images/.+\\.jpg$`),
	)
})

test('the photo request asks only for formats the app stores and encodings it can decode', async () => {
	const session = await cook()
	servePage(`${SITE}/stew.jpg`)
	const headers: Headers[] = []
	server.use(
		http.get(`${CHECKED_ORIGIN}/stew.jpg`, async ({ request }) => {
			headers.push(request.headers)
			return photoResponse(await jpeg())
		}),
	)

	await importStew(session)

	expect(headers).toHaveLength(1)
	const accept = headers[0]!.get('accept')!
	expect(accept).toContain('image/jpeg')
	expect(accept).toContain('image/png')
	expect(accept).toContain('image/webp')
	expect(accept).not.toContain('avif')
	expect(accept).not.toContain('*')
	expect(headers[0]!.get('accept-encoding')).toBe(ACCEPT_ENCODING)
})

test('a photo on a private address, directly or by redirect, is never requested, and the next one is used', async () => {
	const session = await cook()
	const photo = await jpeg()
	servePage([
		'http://10.0.0.5/stew.jpg',
		`${SITE}/moved.jpg`,
		`${SITE}/stew.jpg`,
	])
	const privateHits: string[] = []
	server.use(
		http.get(`${CHECKED_ORIGIN}/moved.jpg`, () =>
			HttpResponse.redirect('http://169.254.169.254/latest/meta-data', 302),
		),
		http.get('http://169.254.169.254/*', ({ request }) => {
			privateHits.push(request.url)
			return photoResponse(photo)
		}),
		http.get('http://10.0.0.5/*', ({ request }) => {
			privateHits.push(request.url)
			return photoResponse(photo)
		}),
		http.get(`${CHECKED_ORIGIN}/stew.jpg`, () => photoResponse(photo)),
	)

	const { id, search } = await importStew(session)

	expect(privateHits).toEqual([])
	expect(search).toBe('?imported=url')
	expect(await storedPhoto(id)).toEqual(photo)
})

test('bytes that are not a photo are refused whatever their type says, and the next candidate is used', async () => {
	const session = await cook()
	const photo = await jpeg(20, 20)
	servePage([
		{ url: `${SITE}/fake.jpg`, width: 2000, height: 1500 },
		{ url: `${SITE}/real.jpg`, width: 400, height: 400 },
	])
	server.use(
		http.get(`${CHECKED_ORIGIN}/fake.jpg`, () =>
			photoResponse(
				new TextEncoder().encode('<html>Not found, but 200</html>'),
			),
		),
		http.get(`${CHECKED_ORIGIN}/real.jpg`, () => photoResponse(photo)),
	)

	const { id } = await importStew(session)

	expect(await storedPhoto(id)).toEqual(photo)
	expect(await storedFiles(session.userId)).toHaveLength(1)
})

test('a photo past the size cap is not stored and stops being read, whatever its Content-Length says', async () => {
	const session = await cook()
	const photo = await jpeg()
	servePage([`${SITE}/endless.jpg`, `${SITE}/declared.jpg`, `${SITE}/ok.jpg`])
	let endlessBytes = 0
	const chunk = new Uint8Array(64 * 1024).fill(0xff)
	server.use(
		http.get(
			`${CHECKED_ORIGIN}/endless.jpg`,
			() =>
				new HttpResponse(
					new ReadableStream({
						pull(controller) {
							endlessBytes += chunk.byteLength
							controller.enqueue(chunk)
						},
					}),
					{ headers: { 'Content-Type': 'image/jpeg' } },
				),
		),
		// A real photo, refused on its Content-Length alone.
		http.get(
			`${CHECKED_ORIGIN}/declared.jpg`,
			async () =>
				new HttpResponse(await jpeg(60, 60), {
					headers: {
						'Content-Type': 'image/jpeg',
						'Content-Length': String(MAX_RECIPE_IMAGE_SIZE + 1),
					},
				}),
		),
		http.get(`${CHECKED_ORIGIN}/ok.jpg`, () => photoResponse(photo)),
	)

	const { id } = await importStew(session)

	expect(await storedPhoto(id)).toEqual(photo)
	// The stream runs a few chunks ahead of the reader.
	expect(endlessBytes).toBeLessThan(MAX_RECIPE_IMAGE_SIZE + 1024 * 1024)
})

test('a missing photo leaves the placeholder and changes nothing about the import', async () => {
	const session = await cook()
	servePage(`${SITE}/gone.jpg`)
	server.use(
		http.get(
			`${CHECKED_ORIGIN}/gone.jpg`,
			() => new HttpResponse(null, { status: 404 }),
		),
	)

	const { id, search } = await importStew(session)

	expect(search).toBe('?imported=url')
	expect(await prisma.recipe.count({ where: { id } })).toBe(1)
	expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
})

test.each([
	['sends nothing at all', 'headers'],
	['sends its headers and then stalls', 'body'],
] as const)(
	'a photo that %s is given up on at its own deadline, and the import still opens the Recipe',
	async (_, stall) => {
		const session = await cook()
		servePage([`${SITE}/slow.jpg`, `${SITE}/never-tried.jpg`])
		let requested!: () => void
		const started = new Promise<void>((resolve) => (requested = resolve))
		let laterCandidateTried = false
		server.use(
			http.get(`${CHECKED_ORIGIN}/slow.jpg`, () => {
				requested()
				if (stall === 'headers') return new Promise<never>(() => {})
				return new HttpResponse(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]))
						},
						pull: () => new Promise(() => {}),
					}),
					{ headers: { 'Content-Type': 'image/jpeg' } },
				)
			}),
			http.get(`${CHECKED_ORIGIN}/never-tried.jpg`, async () => {
				laterCandidateTried = true
				return photoResponse(await jpeg())
			}),
		)

		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		try {
			const result = importStew(session)
			await started
			await vi.advanceTimersByTimeAsync(5_000)
			const { id, search } = await result

			expect(search).toBe('?imported=url')
			expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(
				0,
			)
			// One deadline covers every candidate.
			expect(laterCandidateTried).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	},
)

/** Runs `work` with fake timers, at the moment `started` resolves moved 5 s on. */
async function atPhotoDeadline<T>(
	started: Promise<void>,
	work: () => Promise<T>,
) {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
	try {
		const result = work()
		await started
		await vi.advanceTimersByTimeAsync(5_000)
		return await result
	} finally {
		vi.useRealTimers()
	}
}

test('a photo whose nameserver never answers is given up on at the deadline', async () => {
	const session = await cook()
	servePage('https://slow-dns.example.test/stew.jpg')
	const started = new Promise<void>((resolve) => (slowLookup.started = resolve))

	const { id, search } = await atPhotoDeadline(started, () =>
		importStew(session),
	)

	expect(search).toBe('?imported=url')
	expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
})

test('an upload that storage never answers ends at the deadline, and what it stored is removed', async () => {
	const session = await cook()
	servePage(`${SITE}/stew.jpg`)
	let putStarted!: () => void
	const started = new Promise<void>((resolve) => (putStarted = resolve))
	const bucket = `${process.env.AWS_ENDPOINT_URL_S3}/${process.env.BUCKET_NAME}`
	server.use(
		http.get(`${CHECKED_ORIGIN}/stew.jpg`, async () =>
			photoResponse(await jpeg()),
		),
		// Storage keeps the bytes but never answers the request.
		http.put(`${bucket}/*`, async ({ request }) => {
			const key = decodeURIComponent(new URL(request.url).pathname).slice(
				new URL(bucket).pathname.length + 1,
			)
			const file = path.join(UPLOADS_DIR, key)
			await fs.mkdir(path.dirname(file), { recursive: true })
			await fs.writeFile(file, Buffer.from(await request.arrayBuffer()))
			putStarted()
			return new Promise<never>(() => {})
		}),
	)

	const { id, search } = await atPhotoDeadline(started, () =>
		importStew(session),
	)

	expect(search).toBe('?imported=url')
	expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
	await expect.poll(() => storedFiles(session.userId)).toEqual([])
})

test('no more than three candidates are tried', async () => {
	const session = await cook()
	servePage([1, 2, 3, 4].map((n) => `${SITE}/photos/missing-${n}.jpg`))
	const requested: string[] = []
	server.use(
		http.get(`${CHECKED_ORIGIN}/photos/:name`, ({ params }) => {
			requested.push(String(params.name))
			return new HttpResponse(null, { status: 404 })
		}),
	)

	const { id } = await importStew(session)

	expect(requested).toEqual(['missing-1.jpg', 'missing-2.jpg', 'missing-3.jpg'])
	expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
})

test('a photo waiting for its turn at the photo check gives up at the deadline', async () => {
	const session = await cook()
	servePage(`${SITE}/stew.jpg`)
	let photoServed!: () => void
	const started = new Promise<void>((resolve) => (photoServed = resolve))
	server.use(
		http.get(`${CHECKED_ORIGIN}/stew.jpg`, async () => {
			const response = photoResponse(await jpeg())
			photoServed()
			return response
		}),
	)
	let release!: () => void
	const holder = withPhotoSlot(
		() => new Promise<void>((resolve) => (release = resolve)),
	)
	try {
		const { id, search } = await atPhotoDeadline(started, () =>
			importStew(session),
		)

		expect(search).toBe('?imported=url')
		expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
	} finally {
		release()
		await holder
	}
})

test('a full photo queue ends the photo at once, without trying the other candidates', async () => {
	const session = await cook()
	servePage([`${SITE}/photos/first.jpg`, `${SITE}/photos/second.jpg`])
	const requested: string[] = []
	server.use(
		http.get(`${CHECKED_ORIGIN}/photos/:name`, async ({ params }) => {
			requested.push(String(params.name))
			return photoResponse(await jpeg())
		}),
	)
	let release!: () => void
	const holder = withPhotoSlot(
		() => new Promise<void>((resolve) => (release = resolve)),
	)
	const waiting = Array.from({ length: MAX_WAITING_PHOTO_JOBS }, () =>
		withPhotoSlot(async () => {}),
	)
	try {
		const { id, search } = await importStew(session)

		expect(search).toBe('?imported=url')
		expect(requested).toEqual(['first.jpg'])
		expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
	} finally {
		release()
		await Promise.all([holder, ...waiting])
	}
})

test.each([
	[
		'is deleted',
		async (recipeId: string) => {
			await prisma.recipe.delete({ where: { id: recipeId } })
		},
		0,
	],
	[
		'gets a photo from someone else',
		async (recipeId: string) => {
			await prisma.recipeImage.create({
				data: { recipeId, objectKey: 'users/someone/recipes/x/images/1.jpg' },
			})
		},
		1,
	],
] as const)(
	'a Recipe that %s while its photo is uploading keeps no stored copy of the photo',
	async (_, meanwhile, rows) => {
		const session = await cook()
		servePage(`${SITE}/stew.jpg`)
		server.use(
			http.get(`${CHECKED_ORIGIN}/stew.jpg`, async () =>
				photoResponse(await jpeg()),
			),
		)
		storage.afterUpload = async (recipeId) => {
			expect(await storedFiles(session.userId)).toHaveLength(1)
			await meanwhile(recipeId)
		}

		const { id, search } = await importStew(session)

		expect(search).toBe('?imported=url')
		expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(
			rows,
		)
		await expect.poll(() => storedFiles(session.userId)).toEqual([])
	},
)

test('a photo that storage refuses leaves the placeholder and the import goes through', async () => {
	consoleError.mockImplementation(() => {})
	const session = await cook()
	servePage(`${SITE}/stew.jpg`)
	server.use(
		http.get(`${CHECKED_ORIGIN}/stew.jpg`, async () =>
			photoResponse(await jpeg()),
		),
		http.put(
			`${process.env.AWS_ENDPOINT_URL_S3}/${process.env.BUCKET_NAME}/*`,
			() => new HttpResponse(null, { status: 503 }),
		),
	)

	const { id, search } = await importStew(session)

	expect(search).toBe('?imported=url')
	expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
})

test('a demo user’s import fetches no photo, as photos are off in the demo', async () => {
	const session = await cook({ demo: true })
	servePage(`${SITE}/stew.jpg`)
	let photoRequests = 0
	server.use(
		http.get(`${CHECKED_ORIGIN}/stew.jpg`, async () => {
			photoRequests++
			return photoResponse(await jpeg())
		}),
	)

	const { id, search } = await importStew(session)

	expect(search).toBe('?imported=url')
	expect(photoRequests).toBe(0)
	expect(await prisma.recipeImage.count({ where: { recipeId: id } })).toBe(0)
})
