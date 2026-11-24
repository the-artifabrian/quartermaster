/**
 * The demo template and the per-visitor copy made from it.
 *
 * Failure list:
 * Template
 * - A second build with the same content and photos writes anything: a
 *   second template, new Recipes, new uploads.
 * - A changed photo or changed content doesn't reach the database, because
 *   the build skips Recipes it already has by title.
 * - A rebuild leaves the old template user and Household behind, or deletes
 *   a photo a live copy still shows, or keeps one nobody shows any more.
 * - A missing photo file fails the whole build, or the Recipe is skipped
 *   instead of saved without a photo. When the file turns up later, nothing
 *   picks it up.
 * - A photo the check turns away, which can be for a passing reason (the
 *   photo queue was busy, a decode ran out of time), leaves its Recipe
 *   without a photo, and the stored version says the template is current,
 *   so no later run tries again.
 * - A change to what the template doesn't hold (the Plan, Shopping, the
 *   Menus) rebuilds it anyway, or blocks copies until it is rebuilt.
 * - Two builds at once leave two templates, or the losing build's user and
 *   photos stay behind, or the losing build reports its own deleted user as
 *   the template.
 * - A build that died partway leaves its user and photos behind for good, or
 *   the clean-up removes a build that is still running, or removes the
 *   current template once its owner is more than an hour old.
 * - A clean-up that fails after a failed build hides the build's own error.
 * - The template's owner can sign in (a password, a passkey, a session), has
 *   a `demoExpiresAt` that expiry would act on, or has a username a visitor
 *   could register first.
 * - The template holds a Plan, Shopping or a Menu, which every copy would
 *   then carry from the week it was built.
 * Copy
 * - There is no template yet, or it was built from other content than the
 *   running code's (the window after a deploy), and the copy goes ahead and
 *   fails partway, or makes a user anyway.
 * - At the live-demo cap a copy is still made; expired demo users or real
 *   users count toward the cap.
 * - Parallel starts all pass the cap, because the count and the create are
 *   not one transaction, or another process writes between them.
 * - Copies hold the database lock so long that other starts wait past
 *   Prisma's limit to begin a transaction, and those starts throw instead of
 *   being refused.
 * - The template is rebuilt between the visitor's user being made and the
 *   library copy, and the copy reads a template that is gone.
 * - The demo user isn't on Pro, has no expiry, isn't the owner of a Household
 *   of their own, or has a username or email a real signup could take.
 * - The copy misses Recipes, lines, steps, classification, Staples,
 *   favourites or photos, or its Recipes still belong to the template user.
 * - The copied Recipes all get the same time, so the Recipes list (newest or
 *   last changed first) shows them in a different order from the template.
 * - A sub-Recipe link in the copy points back into the template.
 * - The Menu is missing, or its cards point at the template's Recipes.
 * - The copy's Plan is in the template's week, or the wrong week on a Monday
 *   or a Sunday.
 * - Expiring the copy deletes the template's photos or rows.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import type * as AccountDeletion from './account-deletion.server.ts'
import type * as RecipePhoto from './recipe-photo.server.ts'
import type * as Storage from './storage.server.ts'
import { verifyUserPassword } from './auth.server.ts'
import { deleteAccount } from './account-deletion.server.ts'
import { prisma } from './db.server.ts'
import { DEMO_LIFETIME_MS, DEMO_LIVE_LIMIT } from './demo.ts'
import {
	createDemoCopy,
	DEMO_TEMPLATE_EMAIL_DOMAIN,
	ensureDemoTemplate,
} from './demo.server.ts'
import { getWeekStart, parseDate, serializeDate } from './date.ts'
import {
	SAMPLE_HOUSEHOLD,
	type SampleHouseholdContent,
} from './sample-household-data.ts'
import { checkRecipePhoto } from './recipe-photo.server.ts'
import { getUserTier } from './subscription.server.ts'
import { UsernameSchema } from './user-validation.ts'
import { writeTinyDemoPhotos, writeTinyPhoto } from '#tests/demo-photos.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	createWalDatabase,
	writeAfterFirstRead,
} from '#tests/sqlite-concurrency.ts'
import '#tests/setup/db-setup.ts'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import { server } from '#tests/setup/mocks-setup.ts'

// Whose folders the uploads went into, so each test can remove them, even
// for template owners already deleted.
const uploadedFor = vi.hoisted(() => new Set<string>())
vi.mock('./storage.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof Storage>()
	return {
		...real,
		uploadRecipeImage: vi.fn(
			(...args: Parameters<typeof real.uploadRecipeImage>) => {
				uploadedFor.add(args[0])
				return real.uploadRecipeImage(...args)
			},
		),
	}
})
vi.mock('./recipe-photo.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof RecipePhoto>()
	return { ...real, checkRecipePhoto: vi.fn(real.checkRecipePhoto) }
})
vi.mock('./account-deletion.server.ts', async (importOriginal) => {
	const real = await importOriginal<typeof AccountDeletion>()
	return { ...real, deleteAccount: vi.fn(real.deleteAccount) }
})

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const NOW = new Date('2026-11-26T12:00:00Z')
const THURSDAY = '2026-11-26'

/** The sample Recipes that name a photo. */
const PICTURED = SAMPLE_HOUSEHOLD.recipes.filter((recipe) => recipe.photo)

/** Two Recipes and one Meal, for the tests that make many copies. */
const SMALL: SampleHouseholdContent = {
	recipes: SAMPLE_HOUSEHOLD.recipes.slice(0, 2),
	staples: ['Salt'],
	menus: [],
	plan: [
		{ day: 0, label: 'dinner', recipes: [SAMPLE_HOUSEHOLD.recipes[0]!.title] },
	],
	shopping: { manual: [], boughtThroughDay: -1 },
}

let photoDir: string
const log = { warn: vi.fn(), error: vi.fn() }

/**
 * Tiny photos in a folder of their own. Disposing removes the folder and
 * every upload the test made, even those of template owners since deleted.
 */
async function photos() {
	photoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-photos-'))
	await writeTinyDemoPhotos(photoDir)
	log.warn.mockReset()
	log.error.mockReset()
	return {
		async [Symbol.asyncDispose]() {
			await fs.rm(photoDir, { recursive: true, force: true })
			for (const userId of uploadedFor) {
				await fs.rm(path.join(UPLOADS_DIR, 'users', userId), {
					recursive: true,
					force: true,
				})
			}
			uploadedFor.clear()
		},
	}
}

/** The stored photo files under one user's upload folder. */
async function filesUnder(userId: string) {
	const entries = await fs
		.readdir(path.join(UPLOADS_DIR, 'users', userId), {
			recursive: true,
			withFileTypes: true,
		})
		.catch(() => [])
	return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

const stored = (objectKey: string) =>
	fs.access(path.join(UPLOADS_DIR, objectKey)).then(
		() => true,
		() => false,
	)

function build(options: { content?: SampleHouseholdContent } = {}) {
	return ensureDemoTemplate(prisma, { photoDir, log, ...options })
}

async function template() {
	return prisma.demoTemplate.findUniqueOrThrow({
		where: { id: 'current' },
		select: {
			userId: true,
			householdId: true,
			contentVersion: true,
			photoVersion: true,
		},
	})
}

async function rowCounts() {
	const [users, households, recipes, ingredients, images, values, staples] =
		await Promise.all([
			prisma.user.count(),
			prisma.household.count(),
			prisma.recipe.count(),
			prisma.ingredient.count(),
			prisma.recipeImage.count(),
			prisma.recipeMetadataValue.count(),
			prisma.householdIngredient.count(),
		])
	return { users, households, recipes, ingredients, images, values, staples }
}

/** A Household's library with ids left out, so a template and a copy compare. */
async function library(householdId: string) {
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
		select: {
			title: true,
			description: true,
			activeTime: true,
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
			notes: true,
			isFavorite: true,
			image: { select: { objectKey: true, altText: true } },
			ingredients: {
				orderBy: { order: 'asc' },
				select: { name: true, amount: true, unit: true, notes: true },
			},
			instructions: { orderBy: { order: 'asc' }, select: { content: true } },
			metadataAssignments: {
				orderBy: { value: { nameKey: 'asc' } },
				select: { value: { select: { dimension: true, name: true } } },
			},
		},
	})
	const staples = await prisma.householdIngredient.findMany({
		where: { householdId },
		orderBy: { canonicalKey: 'asc' },
		select: { displayName: true, canonicalKey: true, isStaple: true },
	})
	const values = await prisma.recipeMetadataValue.findMany({
		where: { householdId },
		orderBy: [{ dimension: 'asc' }, { nameKey: 'asc' }],
		select: { dimension: true, name: true, sortOrder: true },
	})
	return { recipes, staples, values }
}

async function startCopy(today = THURSDAY, content?: SampleHouseholdContent) {
	const result = await createDemoCopy(prisma, { today, now: NOW, content })
	if (!result.ok) throw new Error(`The copy was refused: ${result.reason}`)
	return result
}

function liveDemoUser(expiresAt: Date) {
	return prisma.user.create({
		data: { ...createUser(), demoExpiresAt: expiresAt },
		select: { id: true },
	})
}

// Template

test('the template holds the sample Recipes with their photos and the Staples, and nothing dated', async () => {
	await using _photos = await photos()
	const result = await build()
	expect(result.status).toBe('built')
	const { userId, householdId } = await template()

	const { recipes, staples } = await library(householdId)
	expect(recipes.map((recipe) => recipe.title).sort()).toEqual(
		SAMPLE_HOUSEHOLD.recipes.map((recipe) => recipe.title).sort(),
	)
	// Only the Recipes that name a photo have one, with its alt text.
	expect(
		recipes
			.map((recipe) => [recipe.title, recipe.image?.altText ?? null])
			.sort(),
	).toEqual(
		SAMPLE_HOUSEHOLD.recipes
			.map((recipe) => [recipe.title, recipe.photoAlt ?? null])
			.sort(),
	)
	const images = recipes.flatMap((recipe) =>
		recipe.image ? [recipe.image] : [],
	)
	expect(images).toHaveLength(PICTURED.length)
	for (const image of images) {
		expect(image.objectKey).toMatch(new RegExp(`^users/${userId}/recipes/`))
		expect(await stored(image.objectKey)).toBe(true)
	}
	expect(log.warn).not.toHaveBeenCalled()
	expect(staples.map((staple) => staple.displayName).sort()).toEqual(
		[...SAMPLE_HOUSEHOLD.staples].sort(),
	)
	expect(
		await prisma.recipe.count({
			where: { householdId, userId: { not: userId } },
		}),
	).toBe(0)
	expect(await prisma.mealPlan.count({ where: { householdId } })).toBe(0)
	expect(await prisma.shoppingList.count({ where: { householdId } })).toBe(0)
	expect(await prisma.menu.count({ where: { householdId } })).toBe(0)
})

test('a second build with the same content and photos changes nothing', async () => {
	await using _photos = await photos()
	await build()
	const first = await template()
	const before = await rowCounts()

	const again = await build()

	expect(again.status).toBe('current')
	expect(await template()).toEqual(first)
	expect(await rowCounts()).toEqual(before)
})

test('the template’s owner can’t sign in and is never a demo user', async () => {
	await using _photos = await photos()
	await build()
	const { userId } = await template()
	const owner = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: {
			username: true,
			email: true,
			demoExpiresAt: true,
			password: true,
			passkey: { select: { id: true } },
			sessions: { select: { id: true } },
		},
	})

	expect(owner.demoExpiresAt).toBeNull()
	expect(owner.password).toBeNull()
	expect(owner.passkey).toEqual([])
	expect(owner.sessions).toEqual([])
	expect(owner.email.endsWith(`@${DEMO_TEMPLATE_EMAIL_DOMAIN}`)).toBe(true)
	expect(await verifyUserPassword({ username: owner.username }, '')).toBeNull()
	// No signup can register this username first.
	expect(UsernameSchema.safeParse(owner.username).success).toBe(false)
})

test('a changed photo builds a new template; a live copy keeps its photos and an unused one goes', async () => {
	await using _photos = await photos()
	await build()
	const old = await template()
	const copy = await startCopy()
	const copyImages = await prisma.recipeImage.findMany({
		where: { recipe: { householdId: copy.householdId } },
		select: { id: true, objectKey: true },
		orderBy: { objectKey: 'asc' },
	})
	// The visitor removes one photo, so only the template shows it now.
	const dropped = copyImages[0]!
	await prisma.recipeImage.delete({ where: { id: dropped.id } })
	const kept = copyImages.slice(1)

	await writeTinyPhoto(path.join(photoDir, PICTURED[0]!.photo!), 999)
	const result = await build()

	expect(result.status).toBe('built')
	const now = await template()
	expect(now.userId).not.toBe(old.userId)
	expect(now.photoVersion).not.toBe(old.photoVersion)
	expect(now.contentVersion).toBe(old.contentVersion)
	expect(await prisma.user.findUnique({ where: { id: old.userId } })).toBeNull()
	expect(
		await prisma.household.findUnique({ where: { id: old.householdId } }),
	).toBeNull()
	for (const image of kept) expect(await stored(image.objectKey)).toBe(true)
	expect(await stored(dropped.objectKey)).toBe(false)
	expect(
		await prisma.user.count({
			where: { email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` } },
		}),
	).toBe(1)
})

test('changed content builds a new template that has the change', async () => {
	await using _photos = await photos()
	await build()
	const old = await template()
	const [first, ...rest] = SAMPLE_HOUSEHOLD.recipes
	const content: SampleHouseholdContent = {
		...SAMPLE_HOUSEHOLD,
		recipes: [{ ...first!, description: 'Rewritten.' }, ...rest],
	}

	await build({ content })

	const now = await template()
	expect(now.contentVersion).not.toBe(old.contentVersion)
	const recipe = await prisma.recipe.findFirstOrThrow({
		where: { householdId: now.householdId, title: first!.title },
		select: { description: true },
	})
	expect(recipe.description).toBe('Rewritten.')
	expect(await prisma.user.findUnique({ where: { id: old.userId } })).toBeNull()
})

test('a missing photo leaves its Recipe without one, and a later build picks the file up', async () => {
	await using _photos = await photos()
	const missing = PICTURED[1]!
	await fs.rm(path.join(photoDir, missing.photo!))

	const result = await build()

	expect(result.status).toBe('built')
	expect(result.missingPhotos).toEqual([missing.photo])
	expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(missing.photo!))
	const { householdId } = await template()
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		select: { title: true, image: { select: { id: true } } },
	})
	expect(recipes).toHaveLength(SAMPLE_HOUSEHOLD.recipes.length)
	const pictured = recipes.filter((recipe) => recipe.image)
	expect(pictured).toHaveLength(PICTURED.length - 1)
	expect(pictured.map((recipe) => recipe.title)).not.toContain(missing.title)

	await writeTinyPhoto(path.join(photoDir, missing.photo!), 7)
	expect((await build()).status).toBe('built')
	const now = await template()
	expect(
		await prisma.recipeImage.count({
			where: { recipe: { householdId: now.householdId } },
		}),
	).toBe(PICTURED.length)
})

test('two builds at once leave one template, and the other build cleans up after itself', async () => {
	await using _photos = await photos()
	const results = await Promise.all([build(), build()])

	expect(results.map((r) => r.status).sort()).toEqual(['built', 'current'])
	const owners = await prisma.user.findMany({
		where: { email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` } },
		select: { id: true },
	})
	const { userId } = await template()
	expect(owners).toEqual([{ id: userId }])
	expect(await prisma.household.count()).toBe(1)
	// Both report the template that stayed.
	expect(results.map((r) => r.userId)).toEqual([userId, userId])
	const losers = [...uploadedFor].filter((id) => id !== userId)
	expect(losers).toHaveLength(1)
	expect(await filesUnder(losers[0]!)).toEqual([])
	expect(await filesUnder(userId)).toHaveLength(PICTURED.length)
})

test('a build that died partway is cleaned up by the next one, and one still running is left', async () => {
	await using _photos = await photos()
	const stale = await prisma.user.create({
		data: {
			username: 'demo-template-stale',
			email: `stale@${DEMO_TEMPLATE_EMAIL_DOMAIN}`,
			createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
		},
		select: { id: true },
	})
	const running = await prisma.user.create({
		data: {
			username: 'demo-template-running',
			email: `running@${DEMO_TEMPLATE_EMAIL_DOMAIN}`,
		},
		select: { id: true },
	})

	await build()

	expect(await prisma.user.findUnique({ where: { id: stale.id } })).toBeNull()
	expect(
		await prisma.user.findUnique({ where: { id: running.id } }),
	).not.toBeNull()
})

test.each(['busy', 'unusable'] as const)(
	'a photo the check refuses (%s) fails the build, and the next build has it',
	async (reason) => {
		await using _photos = await photos()
		vi.mocked(checkRecipePhoto).mockResolvedValueOnce({ ok: false, reason })

		await expect(build()).rejects.toThrow(new RegExp(reason))

		expect(await prisma.demoTemplate.count()).toBe(0)
		expect(
			await prisma.user.count({
				where: { email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` } },
			}),
		).toBe(0)
		expect((await build()).status).toBe('built')
		const { householdId } = await template()
		expect(
			await prisma.recipeImage.count({ where: { recipe: { householdId } } }),
		).toBe(PICTURED.length)
	},
)

test('a change to the Plan, Shopping or Menus keeps the template and still allows copies', async () => {
	await using _photos = await photos()
	await build()
	const first = await template()
	const content: SampleHouseholdContent = {
		...SAMPLE_HOUSEHOLD,
		plan: SAMPLE_HOUSEHOLD.plan.slice(1),
		menus: [],
		shopping: { ...SAMPLE_HOUSEHOLD.shopping, manual: [] },
	}

	expect((await build({ content })).status).toBe('current')
	expect(await template()).toEqual(first)
	const copy = await createDemoCopy(prisma, {
		today: THURSDAY,
		now: NOW,
		content,
	})
	expect(copy.ok).toBe(true)
})

test('the current template is never swept as abandoned, however old its owner', async () => {
	await using _photos = await photos()
	await build()
	const first = await template()
	await prisma.user.update({
		where: { id: first.userId },
		data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
	})

	const again = await build()

	expect(again).toMatchObject({ status: 'current', abandoned: 0 })
	expect(await template()).toEqual(first)
	expect(
		await prisma.user.findUnique({ where: { id: first.userId } }),
	).not.toBeNull()
})

test('a clean-up that fails after a failed build is logged, and the build’s own error is the one thrown', async () => {
	await using _photos = await photos()
	server.use(
		http.put('*', () => new HttpResponse('storage down', { status: 500 })),
	)
	vi.mocked(deleteAccount).mockRejectedValueOnce(new Error('clean-up broke'))
	// Storage logs the failed upload itself.
	consoleError.mockImplementation(() => {})

	await expect(build()).rejects.toThrow(/Failed to upload/)

	expect(log.error).toHaveBeenCalledWith(
		expect.stringContaining('clean-up broke'),
	)
})

// Copy

test('with no template yet the copy is unavailable and makes no user', async () => {
	await using _photos = await photos()
	const before = await prisma.user.count()
	await expect(
		createDemoCopy(prisma, { today: THURSDAY, now: NOW }),
	).resolves.toEqual({ ok: false, reason: 'unavailable' })
	expect(await prisma.user.count()).toBe(before)
})

test('a template built from other content than the running code’s is unavailable', async () => {
	await using _photos = await photos()
	await build({ content: SMALL })
	const before = await prisma.user.count()

	await expect(
		createDemoCopy(prisma, { today: THURSDAY, now: NOW }),
	).resolves.toEqual({ ok: false, reason: 'unavailable' })
	expect(await prisma.user.count()).toBe(before)
})

test('at the live-demo cap a copy is refused; expired demo users and real users don’t count', async () => {
	await using _photos = await photos()
	await build({ content: SMALL })
	const later = new Date(NOW.getTime() + 60_000)
	for (let i = 0; i < DEMO_LIVE_LIMIT - 1; i++) await liveDemoUser(later)
	await liveDemoUser(new Date(NOW.getTime() - 1))
	await prisma.user.create({ data: createUser() })

	const last = await createDemoCopy(prisma, {
		today: THURSDAY,
		now: NOW,
		content: SMALL,
	})
	expect(last.ok).toBe(true)
	const before = await prisma.user.count()
	await expect(
		createDemoCopy(prisma, { today: THURSDAY, now: NOW, content: SMALL }),
	).resolves.toEqual({ ok: false, reason: 'full' })
	expect(await prisma.user.count()).toBe(before)
})

test('forty starts at once never make more copies than the cap allows, and each one settles', async () => {
	await using _photos = await photos()
	await build({ content: SMALL })

	const results = await Promise.allSettled(
		Array.from({ length: DEMO_LIVE_LIMIT + 10 }, () =>
			createDemoCopy(prisma, {
				today: THURSDAY,
				now: NOW,
				content: SMALL,
				log,
			}),
		),
	)

	expect(results.filter((r) => r.status === 'rejected')).toEqual([])
	const values = results.flatMap((r) =>
		r.status === 'fulfilled' ? [r.value] : [],
	)
	const copies = values.filter((r) => r.ok)
	const refusals = values.filter((r) => !r.ok)
	expect(copies.length).toBeLessThanOrEqual(DEMO_LIVE_LIMIT)
	for (const refusal of refusals) {
		expect(['full', 'unavailable']).toContain(refusal.reason)
	}
	// On a loaded machine some starts wait past maxWait and are refused as
	// unavailable, so the cap may not be reached. A start refused as full
	// saw the cap's worth of users, each of which became a copy or was
	// refused as unavailable; so with no unavailable refusals, exactly the
	// cap's worth went through.
	const unavailable = refusals.filter((r) => r.reason === 'unavailable')
	expect(copies.length + unavailable.length).toBeGreaterThanOrEqual(
		DEMO_LIVE_LIMIT,
	)
	const live = await prisma.user.count({
		where: { demoExpiresAt: { not: null } },
	})
	// A start refused after its user was made deletes it, unless that
	// clean-up couldn't get the database either.
	expect(live).toBeGreaterThanOrEqual(copies.length)
	expect(live).toBeLessThanOrEqual(DEMO_LIVE_LIMIT)
}, 30_000)

test('a write from another process between the count and the create waits for the copy to commit', async () => {
	await using _photos = await photos()
	await using database = await createWalDatabase()
	const { db: wal, url } = database
	await ensureDemoTemplate(wal, { photoDir, log, content: SMALL })
	const later = new Date(NOW.getTime() + 60_000)
	for (let i = 0; i < DEMO_LIVE_LIMIT - 1; i++) {
		await wal.user.create({
			data: { ...createUser(), demoExpiresAt: later },
		})
	}
	// Another server process starting a demo of its own, as a raw insert.
	const other = createUser()
	const { db, state } = writeAfterFirstRead(
		wal,
		url,
		['user', 'count'],
		`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt", "demoExpiresAt") VALUES (?, ?, ?, ?, ?, ?)`,
		[
			'other-demo-user',
			other.email,
			other.username,
			NOW.toISOString(),
			NOW.toISOString(),
			later.toISOString(),
		],
	)

	const result = await createDemoCopy(db, {
		today: THURSDAY,
		now: NOW,
		content: SMALL,
	})
	await state.other?.committed

	expect(result.ok).toBe(true)
	expect(state.landedAtOnce).toBe(false)
	await expect(
		createDemoCopy(wal, { today: THURSDAY, now: NOW, content: SMALL }),
	).resolves.toEqual({ ok: false, reason: 'full' })
	// The other process's insert is still there.
	expect(
		await wal.user.findUnique({ where: { id: 'other-demo-user' } }),
	).not.toBeNull()
})

test('the demo user is a Pro guest who owns their own Household and expires in two hours', async () => {
	await using _photos = await photos()
	await build()
	const copy = await startCopy()

	const user = await prisma.user.findUniqueOrThrow({
		where: { id: copy.userId },
		select: {
			name: true,
			username: true,
			email: true,
			demoExpiresAt: true,
			password: true,
			roles: { select: { name: true } },
			subscription: {
				select: { stripeCustomerId: true, stripeSubscriptionId: true },
			},
			householdMembers: { select: { householdId: true, role: true } },
		},
	})
	expect(user.name).toBe('Guest')
	expect(user.demoExpiresAt).toEqual(new Date(NOW.getTime() + DEMO_LIFETIME_MS))
	expect(user.password).toBeNull()
	expect(user.roles).toEqual([{ name: 'user' }])
	expect(user.subscription).toEqual({
		stripeCustomerId: null,
		stripeSubscriptionId: null,
	})
	expect((await getUserTier(copy.userId)).isProActive).toBe(true)
	expect(user.householdMembers).toEqual([
		{ householdId: copy.householdId, role: 'owner' },
	])
	expect(UsernameSchema.safeParse(user.username).success).toBe(false)
	expect(user.email.endsWith('.invalid')).toBe(true)
})

test('the copy has the template’s library, owned by the visitor, sharing its photo keys', async () => {
	await using _photos = await photos()
	await build()
	const { householdId: templateHouseholdId } = await template()
	const copy = await startCopy()

	const copied = await library(copy.householdId)
	expect(copied).toEqual(await library(templateHouseholdId))
	expect(
		copied.recipes.filter((recipe) => recipe.isFavorite).map((r) => r.title),
	).toEqual(['Banana bread', 'Lemon chicken traybake', 'Red lentil soup'])
	const listOrder = (householdId: string, by: 'createdAt' | 'updatedAt') =>
		prisma.recipe
			.findMany({
				where: { householdId },
				orderBy: { [by]: 'desc' },
				select: { title: true },
			})
			.then((recipes) => recipes.map((recipe) => recipe.title))
	for (const by of ['createdAt', 'updatedAt'] as const) {
		expect(await listOrder(copy.householdId, by)).toEqual(
			await listOrder(templateHouseholdId, by),
		)
	}
	expect(
		await prisma.recipe.count({
			where: { householdId: copy.householdId, userId: { not: copy.userId } },
		}),
	).toBe(0)
})

test('the copy’s Menu points at the copy’s own Recipes', async () => {
	await using _photos = await photos()
	await build()
	const copy = await startCopy()

	const items = await prisma.menuItem.findMany({
		where: { section: { menu: { householdId: copy.householdId } } },
		orderBy: { order: 'asc' },
		select: {
			kind: true,
			recipeTitle: true,
			recipe: { select: { householdId: true } },
			shoppingLines: { select: { name: true } },
		},
	})
	expect(items).toEqual([
		{
			kind: 'recipe',
			recipeTitle: 'Black bean tacos',
			recipe: { householdId: copy.householdId },
			shoppingLines: [],
		},
		{
			kind: 'recipe',
			recipeTitle: 'Greek salad',
			recipe: { householdId: copy.householdId },
			shoppingLines: [],
		},
		{
			kind: 'note',
			recipeTitle: null,
			recipe: null,
			shoppingLines: [{ name: 'tortilla chips' }, { name: 'salsa' }],
		},
	])
})

test('a sub-Recipe link in the copy points at the copy of its Recipe', async () => {
	await using _photos = await photos()
	await build()
	const { householdId } = await template()
	const [parent, child] = await prisma.recipe.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
		select: { id: true, title: true, ingredients: { select: { id: true } } },
	})
	await prisma.ingredient.update({
		where: { id: parent!.ingredients[0]!.id },
		data: { linkedRecipeId: child!.id },
	})

	const copy = await startCopy()

	const linked = await prisma.ingredient.findFirstOrThrow({
		where: {
			recipe: { householdId: copy.householdId, title: parent!.title },
			linkedRecipeId: { not: null },
		},
		select: { linkedRecipe: { select: { title: true, householdId: true } } },
	})
	expect(linked.linkedRecipe).toEqual({
		title: child!.title,
		householdId: copy.householdId,
	})
})

test.each([
	['a Monday', '2026-11-23', 0],
	// Leftovers on Saturday and every weekday Meal; Sunday's two are today.
	['a Sunday', '2026-11-29', 6],
])(
	'on %s the copy plans the visitor’s week, cooked before today',
	async (_, today, cookedMeals) => {
		await using _photos = await photos()
		await build()
		const copy = await startCopy(today)

		const plans = await prisma.mealPlan.findMany({
			where: { householdId: copy.householdId },
			select: {
				weekStart: true,
				meals: {
					select: {
						date: true,
						genericText: true,
						completed: true,
						recipeItems: { select: { cooked: true } },
					},
				},
			},
		})
		expect(plans.map((plan) => serializeDate(plan.weekStart))).toEqual([
			serializeDate(getWeekStart(parseDate(today))),
		])
		const meals = plans[0]!.meals
		expect(meals).toHaveLength(SAMPLE_HOUSEHOLD.plan.length)
		const cooked = meals.filter((meal) =>
			meal.genericText != null
				? meal.completed
				: meal.recipeItems.every((item) => item.cooked),
		)
		expect(cooked).toHaveLength(cookedMeals)
	},
)

test('a template built in another week gives a copy in the visitor’s week', async () => {
	await using _photos = await photos()
	vi.useFakeTimers({ now: new Date('2026-10-01T09:00:00Z'), toFake: ['Date'] })
	try {
		await build()
	} finally {
		vi.useRealTimers()
	}
	const copy = await startCopy(THURSDAY)

	const plans = await prisma.mealPlan.findMany({
		where: { householdId: copy.householdId },
		select: { weekStart: true },
	})
	expect(plans.map((plan) => serializeDate(plan.weekStart))).toEqual([
		'2026-11-23',
	])
})

test('expiring a copy leaves the template’s rows and photos as they were', async () => {
	await using _photos = await photos()
	await build()
	const { householdId } = await template()
	const before = await library(householdId)
	const copy = await startCopy()

	await deleteAccount(copy.userId)

	expect(
		await prisma.user.findUnique({ where: { id: copy.userId } }),
	).toBeNull()
	expect(await library(householdId)).toEqual(before)
	const images = before.recipes.flatMap((recipe) =>
		recipe.image ? [recipe.image] : [],
	)
	expect(images).toHaveLength(PICTURED.length)
	for (const image of images) {
		expect(await stored(image.objectKey)).toBe(true)
	}
})

/**
 * `db` with every start's first interactive transaction (the cap check)
 * held open `ms` longer, as on a slow machine. Each start gets its own.
 */
function slowFirstTransaction(db: PrismaClient, ms: number): PrismaClient {
	let slowed = false
	return new Proxy(db, {
		get(target, key) {
			const value = Reflect.get(target, key) as unknown
			if (key === '$transaction') {
				return (work: unknown, ...rest: unknown[]) => {
					if (typeof work !== 'function' || slowed) {
						return Reflect.apply(target.$transaction, target, [work, ...rest])
					}
					slowed = true
					return Reflect.apply(target.$transaction, target, [
						async (tx: unknown) => {
							await new Promise((resolve) => setTimeout(resolve, ms))
							return (work as (tx: unknown) => Promise<unknown>)(tx)
						},
						...rest,
					])
				}
			}
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
}

test('starts that wait too long for the database are refused, not thrown', async () => {
	await using _photos = await photos()
	await build({ content: SMALL })

	const results = await Promise.allSettled(
		Array.from({ length: DEMO_LIVE_LIMIT + 10 }, () =>
			createDemoCopy(slowFirstTransaction(prisma, 400), {
				today: THURSDAY,
				now: NOW,
				content: SMALL,
			}),
		),
	)

	expect(results.filter((r) => r.status === 'rejected')).toEqual([])
	const values = results.flatMap((r) =>
		r.status === 'fulfilled' ? [r.value] : [],
	)
	expect(values.filter((r) => r.ok).length).toBeGreaterThan(0)
	expect(values).toContainEqual({ ok: false, reason: 'unavailable' })
	// A start refused after its user was made leaves that user for expiry.
	expect(
		await prisma.user.count({ where: { demoExpiresAt: { not: null } } }),
	).toBeGreaterThanOrEqual(values.filter((r) => r.ok).length)
}, 30_000)

test('a template rebuilt between making the visitor and copying the library gives unavailable, and expiry can sweep the visitor', async () => {
	await using _photos = await photos()
	await build()
	let transactions = 0
	// The pointer goes, as a rebuild's switch and clean-up would take it,
	// just before the copy's second transaction.
	const db = new Proxy(prisma, {
		get(target, key) {
			const value = Reflect.get(target, key) as unknown
			if (key === '$transaction') {
				return async (work: unknown, ...rest: unknown[]) => {
					if (typeof work === 'function' && ++transactions === 2) {
						await target.demoTemplate.deleteMany()
					}
					return Reflect.apply(target.$transaction, target, [work, ...rest])
				}
			}
			return typeof value === 'function' ? value.bind(target) : value
		},
	})

	await expect(
		createDemoCopy(db, { today: THURSDAY, now: NOW }),
	).resolves.toEqual({ ok: false, reason: 'unavailable' })

	const visitor = await prisma.user.findFirstOrThrow({
		where: { demoExpiresAt: { not: null } },
		select: {
			demoExpiresAt: true,
			householdMembers: {
				select: { household: { select: { _count: true } } },
			},
		},
	})
	expect(visitor.demoExpiresAt).toEqual(
		new Date(NOW.getTime() + DEMO_LIFETIME_MS),
	)
	expect(visitor.householdMembers[0]!.household._count).toMatchObject({
		recipes: 0,
		mealPlans: 0,
	})
})
