import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { deleteAccount } from './account-deletion.server.ts'
import { createOwnHousehold } from './auth.server.ts'
import { DEMO_LIFETIME_MS, DEMO_LIVE_LIMIT } from './demo.ts'
import { deepCopyRecipes } from './household.server.ts'
import { ensureRecipeMetadataValues } from './recipe-metadata.server.ts'
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
 * hashes the sample content and photoVersion the photo files, so changing
 * either builds a new template from scratch. Building in place can't work:
 * addSampleLibrary skips Recipes it already has by title.
 */

/** The `DemoTemplate` row's id. There is never another. */
const TEMPLATE_ID = 'current'

/**
 * Owners of templates have emails here, and visitors under DEMO_EMAIL_DOMAIN.
 * `.invalid` is reserved, so no real address can be one, and no code can
 * reach one to sign in by email.
 */
export const DEMO_TEMPLATE_EMAIL_DOMAIN = 'demo-template.invalid'
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

/** The content's version, which a copy checks against the template's. */
export function demoContentVersion(content: SampleHouseholdContent) {
	return sha256(JSON.stringify({ format: TEMPLATE_FORMAT, content }))
}

/** Each photo the content names, as bytes, or null when the file is missing. */
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
	status: 'current' | 'built'
	userId: string
	householdId: string
	/** Photo files the content names that weren't there or weren't usable. */
	missingPhotos: string[]
	/** Template owners left by builds that died partway, now deleted. */
	abandoned: number
}

type Log = { warn: (message: string) => void }

/**
 * Make sure the template matches the running code's content and the photo
 * files, and build a new one when it doesn't.
 *
 * A new template is built beside the old one, outside any transaction, and
 * then the pointer moves to it in one write transaction that reads the
 * pointer again first. When another build (another process) has already
 * switched it to the same versions, this build deletes its own template and
 * keeps theirs, so two builds at once leave one template. The old template's
 * owner is deleted after the switch, through deleteAccount, which keeps any
 * photo a copy still shows.
 *
 * A missing or unusable photo is logged and leaves that Recipe without one.
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
	let switched: { oldUserId: string | null } | null
	try {
		switched = await writeTransaction(db, async (tx) => {
			const now = await tx.demoTemplate.findUnique({
				where: { id: TEMPLATE_ID },
				select: { userId: true, contentVersion: true, photoVersion: true },
			})
			if (
				now?.contentVersion === contentVersion &&
				now.photoVersion === photos.version
			) {
				return null
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
			return { oldUserId: now?.userId ?? null }
		})
	} catch (error) {
		await deleteAccount(built.userId)
		throw error
	}
	if (!switched) {
		// Another build got there first with the same template.
		await deleteAccount(built.userId)
	} else if (switched.oldUserId) {
		await deleteAccount(switched.oldUserId)
	}
	return {
		status: 'built',
		userId: built.userId,
		householdId: built.householdId,
		missingPhotos: [...missingPhotos, ...built.unusablePhotos],
		abandoned,
	}
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
		const unusablePhotos: string[] = []
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
				log.warn(
					`Demo template: photo ${recipe.photo} can't be used (${check.reason}), so "${recipe.title}" has no photo`,
				)
				unusablePhotos.push(recipe.photo)
				continue
			}
			const recipeId = recipeIds.get(recipe.title)!
			const objectKey = await uploadRecipeImage(userId, recipeId, check.photo)
			await db.recipeImage.create({
				data: { recipeId, objectKey, altText: recipe.photoAlt ?? null },
			})
		}
		return { userId, householdId, unusablePhotos }
	} catch (error) {
		await deleteAccount(userId)
		throw error
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
	| { ok: true; userId: string; householdId: string }
	| { ok: false; reason: 'full' | 'unavailable' }

/**
 * Give a visitor a demo user of their own: on Pro, expiring after
 * DEMO_LIFETIME_MS, with a copy of the template's library and the sample
 * Menu, and the sample week planned for `today` (the visitor's `yyyy-MM-dd`).
 *
 * One write transaction reads the template, counts the live demo users,
 * creates the user and copies the library. The count and the create have to
 * share it, or parallel starts all pass the cap; reading the template in it
 * too means a rebuild can't delete the template between the read and the
 * copy. The user is created with its `demoExpiresAt`, so if planning the
 * week fails afterwards, expiry still removes it.
 *
 * Returns `unavailable` when there is no template yet, or the template was
 * built from other content than this code's (just after a deploy, until the
 * startup build finishes), and `full` at DEMO_LIVE_LIMIT.
 */
export async function createDemoCopy(
	db: PrismaClient,
	{
		today,
		now = new Date(),
		content = SAMPLE_HOUSEHOLD,
	}: { today: string; now?: Date; content?: SampleHouseholdContent },
): Promise<DemoCopyResult> {
	const contentVersion = demoContentVersion(content)
	const id = createId()
	const started = await writeTransaction(
		db,
		async (tx): Promise<DemoCopyResult> => {
			const template = await tx.demoTemplate.findUnique({
				where: { id: TEMPLATE_ID },
				select: { userId: true, householdId: true, contentVersion: true },
			})
			if (!template || template.contentVersion !== contentVersion) {
				return { ok: false, reason: 'unavailable' }
			}
			const live = await tx.user.count({
				where: { demoExpiresAt: { gt: now } },
			})
			if (live >= DEMO_LIVE_LIMIT) return { ok: false, reason: 'full' }

			const user = await tx.user.create({
				data: {
					// The hyphen keeps it out of signup's reach, as the template's.
					username: `demo-${id}`,
					email: `${id}@${DEMO_EMAIL_DOMAIN}`,
					name: 'Guest',
					demoExpiresAt: new Date(now.getTime() + DEMO_LIFETIME_MS),
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

			const values = await tx.recipeMetadataValue.findMany({
				where: { householdId: template.householdId },
				orderBy: [{ sortOrder: 'asc' }, { nameKey: 'asc' }],
				select: { dimension: true, name: true, nameKey: true, sortOrder: true },
			})
			await ensureRecipeMetadataValues(tx, household.id, values)
			await deepCopyRecipes(tx, {
				from: { userId: template.userId, householdId: template.householdId },
				to: { userId: user.id, householdId: household.id },
			})
			const staples = await tx.householdIngredient.findMany({
				where: { householdId: template.householdId },
				select: { displayName: true, canonicalKey: true, isStaple: true },
			})
			await tx.householdIngredient.createMany({
				data: staples.map((staple) => ({
					...staple,
					householdId: household.id,
				})),
			})
			await addSampleMenus(tx, { householdId: household.id, content })
			return { ok: true, userId: user.id, householdId: household.id }
		},
	)
	if (!started.ok) return started
	await planSampleWeek(db, {
		userId: started.userId,
		householdId: started.householdId,
		today,
		content,
	})
	return started
}
