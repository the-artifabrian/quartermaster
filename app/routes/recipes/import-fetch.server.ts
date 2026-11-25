import { parseWithZod } from '@conform-to/zod/v4'
import * as cheerio from 'cheerio'
import {
	ACCEPT_ENCODING,
	BodyTooLargeError,
	KEEP_BODY_ENCODED,
	readBoundedText,
	UnsupportedEncodingError,
} from '#app/utils/bounded-body.server.ts'
import {
	alreadyImported,
	findRecipeFromUrl,
	importFailure,
	saveImportedRecipe,
} from '#app/utils/import-recipe-save.server.ts'
import { fetchPublicUrl } from '#app/utils/public-url.server.ts'
import {
	extractRecipe,
	findRecipeInJsonLd,
	RecipeShapeError,
} from '#app/utils/recipe-jsonld.server.ts'
import { ImportUrlSchema } from '#app/utils/recipe-validation.ts'

/** The `fetch` intent: read the Recipe from a page's JSON-LD and save it. */
export async function importFromUrl(
	formData: FormData,
	user: { userId: string; householdId: string },
) {
	const submission = parseWithZod(formData, { schema: ImportUrlSchema })
	if (submission.status !== 'success') {
		return importFailure('fetch', 'Enter the full link, starting with https://')
	}

	const { url } = submission.value

	// A link the household already has opens nothing new, so a page shared
	// twice stays one Recipe. Checked before fetching: the answer is the same.
	const existing = await findRecipeFromUrl(user.householdId, url)
	if (existing) return alreadyImported('fetch', existing)

	// One deadline covers the headers and the body.
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), 10000)
	try {
		// Checks the URL and every redirect hop before requesting it, so an
		// import can never reach this machine or the private network.
		const response = await fetchPublicUrl(url, {
			...KEEP_BODY_ENCODED,
			signal: controller.signal,
			headers: {
				'User-Agent':
					'Mozilla/5.0 (compatible; Quartermaster/1.0; +recipe-import)',
				Accept: 'text/html',
				'Accept-Encoding': ACCEPT_ENCODING,
			},
		})

		if (!response) {
			return importFailure(
				'fetch',
				'This link can’t be imported. Use a link to a public web page.',
			)
		}

		// Don't cancel the unread body here: in Bun, cancelling a body that was
		// never read pulls all of it into memory. The abort in `finally`
		// releases the connection instead.
		if (!response.ok) {
			return importFailure(
				'fetch',
				`Couldn’t open that page (error ${response.status})`,
			)
		}

		// Content-Length is the size on the wire, before decompression, so the
		// limit applies to the decoded body as it arrives.
		const html = await readBoundedText(response, {
			maxBytes: 5 * 1024 * 1024,
			signal: controller.signal,
		})
		const $ = cheerio.load(html)

		let recipeData: Record<string, unknown> | null = null

		$('script[type="application/ld+json"]').each((_, el) => {
			if (recipeData) return
			try {
				const parsed = JSON.parse($(el).html() || '')
				recipeData = findRecipeInJsonLd(parsed)
			} catch {
				// skip invalid JSON
			}
		})

		if (!recipeData) {
			return importFailure(
				'fetch',
				'This page has no Recipe Quartermaster can read. Paste the Recipe’s text instead.',
			)
		}

		let recipe
		try {
			recipe = extractRecipe(recipeData, url)
		} catch (error) {
			if (!(error instanceof RecipeShapeError)) throw error
			return importFailure(
				'fetch',
				'The Recipe on this page couldn’t be read. Paste its text instead.',
			)
		}

		return saveImportedRecipe(recipe, 'fetch', user)
	} catch (error) {
		const message =
			error instanceof BodyTooLargeError
				? 'This page is too big to import.'
				: error instanceof UnsupportedEncodingError
					? 'This page couldn’t be read. Paste the Recipe’s text instead.'
					: error instanceof Error && error.name === 'AbortError'
						? 'The site took too long to answer. Try again.'
						: 'Couldn’t open that link. Check it and try again.'
		return importFailure('fetch', message)
	} finally {
		clearTimeout(timeout)
		// Releases the page's connection. Bun keeps downloading a body that
		// was cancelled or left unread until its request is aborted.
		controller.abort()
	}
}
