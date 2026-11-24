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
 * - Two builds at once leave two templates, or the losing build's user and
 *   photos stay behind.
 * - A build that died partway leaves its user and photos behind for good, or
 *   the clean-up removes a build that is still running.
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
 * - The demo user isn't on Pro, has no expiry, isn't the owner of a Household
 *   of their own, or has a username or email a real signup could take.
 * - The copy misses Recipes, lines, steps, classification, Staples,
 *   favourites or photos, or its Recipes still belong to the template user.
 * - A sub-Recipe link in the copy points back into the template.
 * - The Menu is missing, or its cards point at the template's Recipes.
 * - The copy's Plan is in the template's week, or the wrong week on a Monday
 *   or a Sunday.
 * - Expiring the copy deletes the template's photos or rows.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
import { getUserTier } from './subscription.server.ts'
import { UsernameSchema } from './user-validation.ts'
import { writeTinyDemoPhotos, writeTinyPhoto } from '#tests/demo-photos.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	createWalDatabase,
	writeAfterFirstRead,
} from '#tests/sqlite-concurrency.ts'
import '#tests/setup/db-setup.ts'
import '#tests/setup/mocks-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const NOW = new Date('2026-11-26T12:00:00Z')
const THURSDAY = '2026-11-26'

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
const log = { warn: vi.fn() }

beforeEach(async () => {
	photoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-photos-'))
	await writeTinyDemoPhotos(photoDir)
	log.warn.mockReset()
})

afterEach(async () => {
	await fs.rm(photoDir, { recursive: true, force: true })
	const users = await prisma.user.findMany({ select: { id: true } })
	await Promise.all(
		users.map((user) =>
			fs.rm(path.join(UPLOADS_DIR, 'users', user.id), {
				recursive: true,
				force: true,
			}),
		),
	)
})

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
	const result = await build()
	expect(result.status).toBe('built')
	const { userId, householdId } = await template()

	const { recipes, staples } = await library(householdId)
	expect(recipes.map((recipe) => recipe.title).sort()).toEqual(
		SAMPLE_HOUSEHOLD.recipes.map((recipe) => recipe.title).sort(),
	)
	for (const recipe of recipes) {
		const sample = SAMPLE_HOUSEHOLD.recipes.find(
			(r) => r.title === recipe.title,
		)!
		expect(recipe.image?.altText).toBe(sample.photoAlt)
		expect(recipe.image!.objectKey).toMatch(
			new RegExp(`^users/${userId}/recipes/`),
		)
		expect(await stored(recipe.image!.objectKey)).toBe(true)
	}
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
	await build()
	const first = await template()
	const before = await rowCounts()

	const again = await build()

	expect(again.status).toBe('current')
	expect(await template()).toEqual(first)
	expect(await rowCounts()).toEqual(before)
})

test('the template’s owner can’t sign in and is never a demo user', async () => {
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

	await writeTinyPhoto(
		path.join(photoDir, SAMPLE_HOUSEHOLD.recipes[0]!.photo!),
		999,
	)
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
	const missing = SAMPLE_HOUSEHOLD.recipes[1]!
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
	expect(recipes.filter((recipe) => !recipe.image)).toEqual([
		{ title: missing.title, image: null },
	])

	await writeTinyPhoto(path.join(photoDir, missing.photo!), 7)
	expect((await build()).status).toBe('built')
	const now = await template()
	expect(
		await prisma.recipeImage.count({
			where: { recipe: { householdId: now.householdId } },
		}),
	).toBe(SAMPLE_HOUSEHOLD.recipes.length)
})

test('two builds at once leave one template, and the other build cleans up after itself', async () => {
	const results = await Promise.all([build(), build()])

	expect(results.map((r) => r.status).sort()).toEqual(['built', 'built'])
	const owners = await prisma.user.findMany({
		where: { email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` } },
		select: { id: true },
	})
	const { userId } = await template()
	expect(owners).toEqual([{ id: userId }])
	expect(await prisma.household.count()).toBe(1)
	const loser = results.find((r) => r.userId !== userId)!
	expect(await filesUnder(loser.userId)).toEqual([])
	expect(await filesUnder(userId)).toHaveLength(SAMPLE_HOUSEHOLD.recipes.length)
})

test('a build that died partway is cleaned up by the next one, and one still running is left', async () => {
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

// Copy

test('with no template yet the copy is unavailable and makes no user', async () => {
	const before = await prisma.user.count()
	await expect(
		createDemoCopy(prisma, { today: THURSDAY, now: NOW }),
	).resolves.toEqual({ ok: false, reason: 'unavailable' })
	expect(await prisma.user.count()).toBe(before)
})

test('a template built from other content than the running code’s is unavailable', async () => {
	await build({ content: SMALL })
	const before = await prisma.user.count()

	await expect(
		createDemoCopy(prisma, { today: THURSDAY, now: NOW }),
	).resolves.toEqual({ ok: false, reason: 'unavailable' })
	expect(await prisma.user.count()).toBe(before)
})

test('at the live-demo cap a copy is refused; expired demo users and real users don’t count', async () => {
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

test('forty starts at once make exactly as many copies as the cap allows', async () => {
	await build({ content: SMALL })

	const results = await Promise.all(
		Array.from({ length: DEMO_LIVE_LIMIT + 10 }, () =>
			createDemoCopy(prisma, { today: THURSDAY, now: NOW, content: SMALL }),
		),
	)

	expect(results.filter((r) => r.ok)).toHaveLength(DEMO_LIVE_LIMIT)
	expect(results.filter((r) => !r.ok)).toEqual(
		Array.from({ length: 10 }, () => ({ ok: false, reason: 'full' })),
	)
	expect(
		await prisma.user.count({ where: { demoExpiresAt: { not: null } } }),
	).toBe(DEMO_LIVE_LIMIT)
})

test('a write from another process between the count and the create waits for the copy to commit', async () => {
	await using database = await createWalDatabase()
	const { db: wal, url } = database
	const built = await ensureDemoTemplate(wal, {
		photoDir,
		log,
		content: SMALL,
	})
	// Its photos aren't under a user of the shared test database.
	await using _uploads = {
		async [Symbol.asyncDispose]() {
			await fs.rm(path.join(UPLOADS_DIR, 'users', built.userId), {
				recursive: true,
				force: true,
			})
		},
	}
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
	await build()
	const { householdId: templateHouseholdId } = await template()
	const copy = await startCopy()

	const copied = await library(copy.householdId)
	expect(copied).toEqual(await library(templateHouseholdId))
	expect(
		copied.recipes.filter((recipe) => recipe.isFavorite).map((r) => r.title),
	).toEqual(['Banana bread', 'Lemon chicken traybake', 'Red lentil soup'])
	expect(
		await prisma.recipe.count({
			where: { householdId: copy.householdId, userId: { not: copy.userId } },
		}),
	).toBe(0)
})

test('the copy’s Menu points at the copy’s own Recipes', async () => {
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
	['a Sunday', '2026-11-29', 7],
])(
	'on %s the copy plans the visitor’s week, cooked before today',
	async (_, today, cookedMeals) => {
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
	await build()
	const { householdId } = await template()
	const before = await library(householdId)
	const copy = await startCopy()

	await deleteAccount(copy.userId)

	expect(
		await prisma.user.findUnique({ where: { id: copy.userId } }),
	).toBeNull()
	expect(await library(householdId)).toEqual(before)
	for (const recipe of before.recipes) {
		expect(await stored(recipe.image!.objectKey)).toBe(true)
	}
})
