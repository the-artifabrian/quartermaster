import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createId } from '@paralleldrive/cuid2'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { deleteAccount } from './account-deletion.server.ts'
import { createOwnHousehold } from './auth.server.ts'
import { prisma } from './db.server.ts'
import {
	DEMO_LIFETIME_MS,
	DEMO_LIVE_LIMIT,
	DEMO_TEMPLATE_EMAIL_DOMAIN,
} from './demo.ts'
import { deepCopyRecipes } from './household.server.ts'
import { checkRecipePhoto } from './recipe-photo.server.ts'
import {
	SAMPLE_HOUSEHOLD,
	type SampleHouseholdContent,
} from './sample-household-data.ts'
import {
	addSampleLibrary,
	addSampleMenus,
	planSampleWeek,
} from './sample-household.server.ts'
import { uploadRecipeImage } from './storage.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * The demo is built in two steps:
 *
 * - ensureDemoTemplate keeps one template Household in the database: the
 *   sample Recipes with their photos and the Staples, owned by a user nobody
 *   can sign in as. Scheduled maintenance runs it at startup and every hour.
 * - createDemoCopy gives one visitor a user of their own with a copy of that
 *   library, the sample Menu, and a Plan and Shopping for the visitor's week.
 *
 * The `DemoTemplate` row points at the current template. Its contentVersion
 * hashes what the template holds (the sample Recipes and Staples) and
 * photoVersion the photo files, so changing either builds a new template
 * from scratch. Building in place can't work: addSampleLibrary skips Recipes
 * it already has by title. The Plan, Shopping and Menus are made on each
 * copy from the running code's content, so changing them needs no rebuild.
 */

/** The `DemoTemplate` row's id. There is never another. */
const TEMPLATE_ID = 'current'

/**
 * Visitors have emails here, and owners of templates under
 * DEMO_TEMPLATE_EMAIL_DOMAIN (demo.ts). `.invalid` is reserved, so no real
 * address can be one, and no code can reach one to sign in by email.
 */
export { DEMO_TEMPLATE_EMAIL_DOMAIN }
export const DEMO_EMAIL_DOMAIN = 'demo.invalid'

/**
 * Raise this when the way the template is built changes, so every database
 * builds a new one even though the content didn't change.
 */
const TEMPLATE_FORMAT = 1

/**
 * A template owner this old that isn't the current template is a build that
 * died partway; a build takes seconds. Younger ones may still be running.
 */
const ABANDONED_BUILD_MS = 60 * 60 * 1000

/**
 * The libSQL adapter runs one transaction at a time in the process, so every
 * copy's transaction makes every other request wait. A start that can't
 * begin within maxWait is refused as `unavailable` rather than queueing
 * behind a crowd of others.
 */
const COPY_TRANSACTION = { maxWait: 2_000, timeout: 10_000 }

/**
 * Where the stock photos the sample Recipes name are read from. It ships in
 * the production image (other/Dockerfile copies everything but what
 * Dockerfile.dockerignore leaves out). DEMO_PHOTO_DIR overrides it, so the
 * e2e run and its server both use tiny generated photos.
 */
export function demoPhotoDir() {
	return (
		process.env.DEMO_PHOTO_DIR ||
		path.join(process.cwd(), 'app/assets/demo-photos')
	)
}

function sha256(value: string | Uint8Array) {
	return createHash('sha256').update(value).digest('hex')
}

/**
 * The version of what the template holds: the Recipes (with their photo
 * names and alt text) and the Staples. A copy checks it against the
 * template's, so a copy never reads a template from other Recipes.
 */
export function demoContentVersion(content: SampleHouseholdContent) {
	return sha256(
		JSON.stringify({
			format: TEMPLATE_FORMAT,
			recipes: content.recipes,
			staples: content.staples,
		}),
	)
}

/**
 * Each photo the content names, as bytes, or null when the file is missing.
 * Only named files are read, so anything else in the folder (the credits)
 * counts for nothing.
 */
async function readPhotos(dir: string, content: SampleHouseholdContent) {
	const files = new Map<string, Uint8Array<ArrayBuffer> | null>()
	for (const recipe of content.recipes) {
		if (!recipe.photo || files.has(recipe.photo)) continue
		const bytes = await fs
			.readFile(path.join(dir, recipe.photo))
			.then((buffer) => new Uint8Array(buffer))
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') return null
				throw error
			})
		files.set(recipe.photo, bytes)
	}
	const version = sha256(
		JSON.stringify(
			[...files].map(([file, bytes]) => [file, bytes ? sha256(bytes) : null]),
		),
	)
	return { files, version }
}

export type DemoTemplateSummary = {
	/** `current` when this run left the template it found, or one another run built. */
	status: 'current' | 'built'
	userId: string
	householdId: string
	/** Photo files the content names that weren't there. */
	missingPhotos: string[]
	/** Template owners left by builds that died partway, now deleted. */
	abandoned: number
}

type Log = {
	warn: (message: string) => void
	error: (message: string) => void
}

/**
 * Make sure the template matches the running code's Recipes, Staples and
 * photo files, and build a new one when it doesn't.
 *
 * A new template is built beside the old one, outside any transaction, and
 * then the pointer moves to it in one write transaction that reads the
 * pointer again first. When another build (another process) has already
 * switched it to the same versions, this build deletes its own template and
 * reports theirs, so two builds at once leave one template. The old
 * template's owner is deleted after the switch, through deleteAccount, which
 * keeps any photo a copy still shows.
 *
 * A missing photo file is logged and leaves that Recipe without a photo; the
 * file turning up changes the photo hash, so a later run picks it up. A photo
 * the photo check refuses fails the build instead: the refusal can be
 * passing (the photo queue was busy, a decode ran out of time), and a
 * template stored without the photo would look current and never be retried.
 * The next run tries again.
 *
 * deleteAccount works on the app's own client, so a build that has a
 * template or an abandoned build to delete must be given that client.
 */
export async function ensureDemoTemplate(
	db: PrismaClient,
	{
		photoDir = demoPhotoDir(),
		content = SAMPLE_HOUSEHOLD,
		log = console,
	}: { photoDir?: string; content?: SampleHouseholdContent; log?: Log } = {},
): Promise<DemoTemplateSummary> {
	const contentVersion = demoContentVersion(content)
	const photos = await readPhotos(photoDir, content)
	const current = await db.demoTemplate.findUnique({
		where: { id: TEMPLATE_ID },
		select: {
			userId: true,
			householdId: true,
			contentVersion: true,
			photoVersion: true,
		},
	})
	const abandoned = await deleteAbandonedTemplates(db, current?.userId)
	const missingPhotos = [...photos.files]
		.filter(([, bytes]) => !bytes)
		.map(([file]) => file)
	if (
		current?.contentVersion === contentVersion &&
		current.photoVersion === photos.version
	) {
		return {
			status: 'current',
			userId: current.userId,
			householdId: current.householdId,
			missingPhotos,
			abandoned,
		}
	}

	const built = await buildTemplate(db, { content, photos: photos.files, log })
	const switched = await writeTransaction(db, async (tx) => {
		const now = await tx.demoTemplate.findUnique({
			where: { id: TEMPLATE_ID },
			select: {
				userId: true,
				householdId: true,
				contentVersion: true,
				photoVersion: true,
			},
		})
		if (
			now?.contentVersion === contentVersion &&
			now.photoVersion === photos.version
		) {
			return { won: false as const, winner: now }
		}
		const pointer = {
			userId: built.userId,
			householdId: built.householdId,
			contentVersion,
			photoVersion: photos.version,
			builtAt: new Date(),
		}
		await tx.demoTemplate.upsert({
			where: { id: TEMPLATE_ID },
			create: { id: TEMPLATE_ID, ...pointer },
			update: pointer,
		})
		return { won: true as const, oldUserId: now?.userId ?? null }
	}).catch((error: unknown) => cleanUpAfterFailure(built.userId, error, log))
	if (!switched.won) {
		// Another build got there first with the same template.
		await deleteAccount(built.userId)
		return {
			status: 'current',
			userId: switched.winner.userId,
			householdId: switched.winner.householdId,
			missingPhotos,
			abandoned,
		}
	}
	if (switched.oldUserId) await deleteAccount(switched.oldUserId)
	return {
		status: 'built',
		userId: built.userId,
		householdId: built.householdId,
		missingPhotos,
		abandoned,
	}
}

/**
 * Delete a half-built template after `error`, then throw `error`. A clean-up
 * that fails too is logged, not thrown, so the cause stays the one reported;
 * the abandoned-build sweep removes the template later.
 */
async function cleanUpAfterFailure(
	userId: string,
	error: unknown,
	log: Log,
): Promise<never> {
	try {
		await deleteAccount(userId)
	} catch (cleanUpError) {
		log.error(
			`Demo template: couldn't delete the failed build's owner ${userId}: ${cleanUpError instanceof Error ? cleanUpError.message : String(cleanUpError)}`,
		)
	}
	throw error
}

/**
 * A new template owner and Household holding the sample library, with the
 * photos uploaded the way a Recipe's photo is. A failure partway deletes
 * what it made.
 */
async function buildTemplate(
	db: PrismaClient,
	{
		content,
		photos,
		log,
	}: {
		content: SampleHouseholdContent
		photos: Map<string, Uint8Array<ArrayBuffer> | null>
		log: Log
	},
) {
	const id = createId()
	const { userId, householdId } = await db.$transaction(async (tx) => {
		const user = await tx.user.create({
			data: {
				// A hyphen, which signup's username rules refuse, so no visitor
				// can register this name first.
				username: `demo-template-${id}`,
				email: `${id}@${DEMO_TEMPLATE_EMAIL_DOMAIN}`,
				name: 'Sample Household',
			},
			select: { id: true, name: true, username: true },
		})
		const household = await createOwnHousehold(tx, user)
		return { userId: user.id, householdId: household.id }
	})
	try {
		await addSampleLibrary(db, { userId, householdId, content })
		const recipes = await db.recipe.findMany({
			where: { householdId },
			select: { id: true, title: true },
		})
		const recipeIds = new Map(recipes.map((r) => [r.title, r.id]))
		for (const recipe of content.recipes) {
			if (!recipe.photo) continue
			const bytes = photos.get(recipe.photo)
			if (!bytes) {
				log.warn(
					`Demo template: no photo file ${recipe.photo}, so "${recipe.title}" has no photo`,
				)
				continue
			}
			const check = await checkRecipePhoto(new Blob([bytes]))
			if (!check.ok) {
				throw new Error(
					`Demo template: photo ${recipe.photo} was refused (${check.reason}); trying again next run`,
				)
			}
			const recipeId = recipeIds.get(recipe.title)!
			const objectKey = await uploadRecipeImage(userId, recipeId, check.photo)
			await db.recipeImage.create({
				data: { recipeId, objectKey, altText: recipe.photoAlt ?? null },
			})
		}
		return { userId, householdId }
	} catch (error) {
		return cleanUpAfterFailure(userId, error, log)
	}
}

/**
 * Delete template owners that are neither the current template nor young
 * enough to be a build still running.
 */
async function deleteAbandonedTemplates(
	db: PrismaClient,
	currentUserId: string | undefined,
) {
	const abandoned = await db.user.findMany({
		where: {
			email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` },
			createdAt: { lt: new Date(Date.now() - ABANDONED_BUILD_MS) },
			...(currentUserId ? { id: { not: currentUserId } } : {}),
		},
		select: { id: true },
	})
	for (const user of abandoned) await deleteAccount(user.id)
	return abandoned.length
}

export type DemoCopyResult =
	| { ok: true; userId: string; householdId: string; demoExpiresAt: Date }
	| { ok: false; reason: 'full' | 'unavailable' }

/** Prisma's error for a transaction that couldn't begin, or ran too long. */
function isTransactionTimeout(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 'P2028'
	)
}

/**
 * Give a visitor a demo user of their own: on Pro, expiring after
 * DEMO_LIFETIME_MS, with a copy of the template's library and the sample
 * Menu, and the sample week planned for `today` (the visitor's `yyyy-MM-dd`).
 *
 * The libSQL adapter runs one transaction at a time in the process, so the
 * work is split into short ones:
 *
 * 1. Read the template, count the live demo users and create the user and
 *    their Household. The count and the create share a write transaction,
 *    or parallel starts all pass the cap.
 * 2. Read the template again and copy its library, a statement per kind of
 *    row. A rebuild may have replaced the template since step 1, and the
 *    second read sees that; the copy is then `unavailable`.
 * 3. Plan the sample week through the app's own Meal and Shopping writers.
 *
 * Returns `unavailable` when there is no template yet, or the template holds
 * other Recipes than this code's (just after a deploy, until the startup
 * build finishes), or a transaction couldn't begin in time because the
 * database is busy; and `full` at DEMO_LIVE_LIMIT.
 *
 * When step 2 or 3 fails, the user step 1 made is deleted before the copy is
 * refused (or the error thrown), so it doesn't hold a live slot. A clean-up
 * that fails too is logged and the user is left to expiry, which deletes it
 * once its `demoExpiresAt` passes. deleteAccount works on the app's own
 * client, so the clean-up does too, whatever `db` is.
 */
export async function createDemoCopy(
	db: PrismaClient,
	{
		today,
		now = new Date(),
		content = SAMPLE_HOUSEHOLD,
		log = console,
	}: {
		today: string
		now?: Date
		content?: SampleHouseholdContent
		log?: Pick<Log, 'error'>
	},
): Promise<DemoCopyResult> {
	let started: DemoCopyResult
	try {
		started = await startDemoUser(db, { now, content })
	} catch (error) {
		if (isTransactionTimeout(error)) return { ok: false, reason: 'unavailable' }
		throw error
	}
	if (!started.ok) return started
	try {
		const copied = await copyTemplateLibrary(db, { ...started, content })
		if (!copied.ok) {
			await deleteHalfMadeVisitor(started.userId, log)
			return copied
		}
		await planSampleWeek(db, {
			userId: started.userId,
			householdId: started.householdId,
			today,
			content,
		})
		return started
	} catch (error) {
		await deleteHalfMadeVisitor(started.userId, log)
		if (isTransactionTimeout(error)) return { ok: false, reason: 'unavailable' }
		throw error
	}
}

/** Delete a visitor whose copy failed partway; a failure is only logged. */
async function deleteHalfMadeVisitor(userId: string, log: Pick<Log, 'error'>) {
	try {
		await deleteDemoUser(userId)
	} catch (error) {
		log.error(
			`Demo copy: couldn't delete the half-made visitor ${userId}, leaving it to expiry: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/** Step 1 of createDemoCopy: the cap, the user and their empty Household. */
function startDemoUser(
	db: PrismaClient,
	{ now, content }: { now: Date; content: SampleHouseholdContent },
) {
	const contentVersion = demoContentVersion(content)
	const id = createId()
	return writeTransaction(
		db,
		async (tx): Promise<DemoCopyResult> => {
			const template = await tx.demoTemplate.findUnique({
				where: { id: TEMPLATE_ID },
				select: { contentVersion: true },
			})
			if (template?.contentVersion !== contentVersion) {
				return { ok: false, reason: 'unavailable' }
			}
			const live = await tx.user.count({
				where: { demoExpiresAt: { gt: now } },
			})
			if (live >= DEMO_LIVE_LIMIT) return { ok: false, reason: 'full' }

			const demoExpiresAt = new Date(now.getTime() + DEMO_LIFETIME_MS)
			const user = await tx.user.create({
				data: {
					// The hyphen keeps it out of signup's reach, as the template's.
					username: `demo-${id}`,
					email: `${id}@${DEMO_EMAIL_DOMAIN}`,
					name: 'Guest',
					demoExpiresAt,
					roles: {
						connectOrCreate: {
							where: { name: 'user' },
							create: { name: 'user' },
						},
					},
					// Pro with no end date and no Stripe ids: the demo ends when
					// expiry deletes the user, and no Pro expiry notice shows meanwhile.
					subscription: { create: { tier: 'pro' } },
				},
				select: { id: true, name: true, username: true },
			})
			const household = await createOwnHousehold(tx, user)
			return {
				ok: true,
				userId: user.id,
				householdId: household.id,
				demoExpiresAt,
			}
		},
		COPY_TRANSACTION,
	)
}

/** Step 2 of createDemoCopy: the template's library, and the sample Menus. */
function copyTemplateLibrary(
	db: PrismaClient,
	{
		userId,
		householdId,
		content,
	}: { userId: string; householdId: string; content: SampleHouseholdContent },
) {
	const contentVersion = demoContentVersion(content)
	return writeTransaction(
		db,
		async (tx): Promise<{ ok: true } | DemoCopyResult> => {
			const template = await tx.demoTemplate.findUnique({
				where: { id: TEMPLATE_ID },
				select: { userId: true, householdId: true, contentVersion: true },
			})
			if (!template || template.contentVersion !== contentVersion) {
				return { ok: false, reason: 'unavailable' }
			}
			await copyClassification(tx, template.householdId, householdId)
			await deepCopyRecipes(tx, {
				from: { userId: template.userId, householdId: template.householdId },
				to: { userId, householdId },
			})
			const staples = await tx.householdIngredient.findMany({
				where: { householdId: template.householdId },
				select: { displayName: true, canonicalKey: true, isStaple: true },
			})
			await tx.householdIngredient.createMany({
				data: staples.map((staple) => ({ ...staple, householdId })),
			})
			await addSampleMenus(tx, { householdId, content })
			return { ok: true }
		},
		COPY_TRANSACTION,
	)
}

/**
 * The template's classification values the copy doesn't have yet, unused
 * ones included. The copy starts with the default Seasons and Courses.
 */
async function copyClassification(
	tx: Prisma.TransactionClient,
	fromHouseholdId: string,
	toHouseholdId: string,
) {
	const [values, existing] = await Promise.all([
		tx.recipeMetadataValue.findMany({
			where: { householdId: fromHouseholdId },
			select: { dimension: true, name: true, nameKey: true, sortOrder: true },
		}),
		tx.recipeMetadataValue.findMany({
			where: { householdId: toHouseholdId },
			select: { dimension: true, nameKey: true },
		}),
	])
	const have = new Set(existing.map((v) => `${v.dimension}\u0000${v.nameKey}`))
	await tx.recipeMetadataValue.createMany({
		data: values
			.filter((v) => !have.has(`${v.dimension}\u0000${v.nameKey}`))
			.map((value) => ({ ...value, householdId: toHouseholdId })),
	})
}

/** Prisma's error for a row that was already gone. */
function isRecordNotFound(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 'P2025'
	)
}

/**
 * Delete `userId` through deleteAccount if it is a demo user, whether or not
 * its time is up. Returns whether this call deleted it: false for a real
 * user or the template's owner (no `demoExpiresAt`), which it never
 * touches, and for a user something else already deleted (Log Out and
 * expiry at once, or a double submit). A not-found error while the user is
 * still there is thrown.
 */
export async function deleteDemoUser(userId: string) {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { demoExpiresAt: true },
	})
	if (!user?.demoExpiresAt) return false
	try {
		await deleteAccount(userId)
		return true
	} catch (error) {
		// Gone already, unless the user is still there and the not-found
		// was about something else.
		if (
			isRecordNotFound(error) &&
			!(await prisma.user.findUnique({
				where: { id: userId },
				select: { id: true },
			}))
		) {
			return false
		}
		throw error
	}
}

/**
 * Delete a demo user now, as Log Out and the demo banner's Sign up do, so
 * its live slot frees at once. Real users are left alone. A delete that
 * fails is logged, and expiry deletes the user when its time is up, so the
 * caller can still end the session.
 */
export async function endDemoUser(userId: string) {
	try {
		await deleteDemoUser(userId)
	} catch (error) {
		console.error(
			`Demo: couldn't delete demo user ${userId}, leaving it to expiry: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

export type DemoExpirySummary = { deleted: number; failed: number }

/**
 * Delete every demo user whose `demoExpiresAt` has passed, each through
 * deleteAccount in a transaction of its own. A user that can't be deleted
 * goes to `onFailure` and the rest still go; the next run tries it again.
 * Users with no `demoExpiresAt` (real users, the template's owner) are never
 * read.
 */
export async function expireDemoUsers({
	now = new Date(),
	onFailure,
}: {
	now?: Date
	onFailure: (userId: string, error: unknown) => void
}): Promise<DemoExpirySummary> {
	const expired = await prisma.user.findMany({
		where: { demoExpiresAt: { lte: now } },
		select: { id: true },
	})
	const summary = { deleted: 0, failed: 0 }
	for (const { id } of expired) {
		try {
			if (await deleteDemoUser(id)) summary.deleted++
		} catch (error) {
			summary.failed++
			onFailure(id, error)
		}
	}
	return summary
}

/**
 * The users that are real accounts: neither a demo visitor nor a template's
 * owner. For lists of accounts, such as the admin pages. The email domain
 * also catches a template build still running or one that died partway,
 * which the DemoTemplate pointer doesn't name.
 */
export const REAL_USER_WHERE = {
	demoExpiresAt: null,
	NOT: { email: { endsWith: `@${DEMO_TEMPLATE_EMAIL_DOMAIN}` } },
} satisfies Prisma.UserWhereInput
