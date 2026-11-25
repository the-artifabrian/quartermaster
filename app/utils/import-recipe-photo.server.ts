import { type PrismaClient } from '#app/generated/prisma/client.ts'
import {
	ACCEPT_ENCODING,
	KEEP_BODY_ENCODED,
	readBoundedBytes,
} from './bounded-body.server.ts'
import { prisma } from './db.server.ts'
import { fetchPublicUrl } from './public-url.server.ts'
import {
	checkRecipePhoto,
	type CheckedRecipePhoto,
} from './recipe-photo.server.ts'
import { MAX_RECIPE_IMAGE_SIZE } from './recipe-validation.ts'
import { deleteRecipeImage, uploadRecipeImage } from './storage.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * How long a URL import spends on its photo, over every candidate: the
 * lookups, requests and bodies, the wait for a turn at the photo check, and
 * the upload to storage. A photo check that already holds its turn can't be
 * stopped and may run to sharp's own limit (PHOTO_JOB_SECONDS), though the
 * 3 MB cap and the decode limits keep it short. The cook is waiting on the
 * import, so the deadline is short. A recipe site's photo is usually a few
 * hundred KB from a CDN and arrives in well under a second.
 */
export const PHOTO_DEADLINE_MS = 5000

/**
 * A fetched photo is held to the upload limit, so it can't cost more to
 * store or resize than a photo picked in the form.
 */
const MAX_PHOTO_BYTES = MAX_RECIPE_IMAGE_SIZE

/** Candidates tried before giving up, when the larger ones fail. */
const MAX_PHOTO_ATTEMPTS = 3

/**
 * The first candidate that downloads within the limits and passes the
 * upload's photo check, or null. Every request goes through
 * `fetchPublicUrl`, so a photo URL, or any redirect from it, can't reach a
 * private address.
 */
async function fetchFirstUsablePhoto(urls: string[], signal: AbortSignal) {
	for (const url of urls.slice(0, MAX_PHOTO_ATTEMPTS)) {
		if (signal.aborted) return null
		// Each attempt ends its own connection: Bun keeps downloading a body
		// that was left unread until its request is aborted.
		const attempt = new AbortController()
		const attemptSignal = AbortSignal.any([signal, attempt.signal])
		try {
			const response = await fetchPublicUrl(url, {
				...KEEP_BODY_ENCODED,
				signal: attemptSignal,
				headers: {
					'User-Agent':
						'Mozilla/5.0 (compatible; Quartermaster/1.0; +recipe-import)',
					// Only what the photo check takes, so a CDN that picks the
					// format by this header doesn't answer with AVIF.
					Accept: 'image/webp, image/jpeg, image/png',
					'Accept-Encoding': ACCEPT_ENCODING,
				},
			})
			if (!response?.ok) continue
			const length = Number(response.headers.get('Content-Length'))
			if (length > MAX_PHOTO_BYTES) continue
			const bytes = await readBoundedBytes(response, {
				maxBytes: MAX_PHOTO_BYTES,
				signal: attemptSignal,
			})
			const check = await checkRecipePhoto(new Blob([bytes]), { signal })
			if (check.ok) return check.photo
			// The queue is full; a smaller candidate would wait just the same.
			if (check.reason === 'busy') return null
		} catch {
			// Unreachable, too big, too slow or unreadable: try the next one.
		} finally {
			attempt.abort()
		}
	}
	return null
}

/**
 * Store the photo and attach it to the Recipe, unless the Recipe was deleted
 * or got a photo of its own while this one was loading. Then the stored copy
 * is removed, so nothing is left in storage that no Recipe shows.
 */
async function attachPhoto(
	{ userId, recipeId }: { userId: string; recipeId: string },
	photo: CheckedRecipePhoto,
	db: PrismaClient,
	signal: AbortSignal,
) {
	const objectKey = await uploadRecipeImage(userId, recipeId, photo, {
		signal,
	})
	let attached = false
	try {
		// In one write transaction with the check, as a delete reads its photo
		// in one with the delete (deleteRecipeAndPhoto).
		attached = await writeTransaction(db, async (tx) => {
			const recipe = await tx.recipe.findUnique({
				where: { id: recipeId },
				select: { image: { select: { id: true } } },
			})
			if (!recipe || recipe.image) return false
			await tx.recipeImage.create({ data: { recipeId, objectKey } })
			return true
		})
	} finally {
		// In the background, so a slow storage delete never holds the import.
		if (!attached) {
			void deleteRecipeImage(objectKey).catch((error: unknown) => {
				console.error('Left an unattached imported photo behind', error)
			})
		}
	}
}

/**
 * Give a just-imported Recipe the photo its page names, if one of them can be
 * fetched in time and passes the upload's checks. It never throws: a slow,
 * missing or broken photo leaves the Recipe with its placeholder.
 */
export async function importRecipePhoto(
	urls: string[],
	recipe: { userId: string; recipeId: string },
	db: PrismaClient = prisma,
) {
	if (!urls.length) return
	const deadline = new AbortController()
	const timer = setTimeout(() => deadline.abort(), PHOTO_DEADLINE_MS)
	try {
		const photo = await fetchFirstUsablePhoto(urls, deadline.signal)
		if (photo) await attachPhoto(recipe, photo, db, deadline.signal)
	} catch (error) {
		// Running out of time is an expected end, like a slow photo.
		if (!deadline.signal.aborted) {
			console.error('Attaching an imported photo failed:', error)
		}
	} finally {
		clearTimeout(timer)
		deadline.abort()
	}
}
