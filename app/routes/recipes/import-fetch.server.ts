import { parseWithZod } from '@conform-to/zod/v4'
import * as cheerio from 'cheerio'
import { data } from 'react-router'
import {
	ACCEPT_ENCODING,
	BodyTooLargeError,
	KEEP_BODY_ENCODED,
	readBoundedText,
	UnsupportedEncodingError,
} from '#app/utils/bounded-body.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type DuplicateMatch } from '#app/utils/import-recipe-types.ts'
import { fetchPublicUrl } from '#app/utils/public-url.server.ts'
import {
	extractRecipe,
	findRecipeInJsonLd,
	RecipeShapeError,
} from '#app/utils/recipe-jsonld.server.ts'
import { ImportUrlSchema } from '#app/utils/recipe-validation.ts'

/** The `fetch` intent: read the Recipe from a page's JSON-LD. */
export async function importFromUrl(
	formData: FormData,
	{ householdId }: { householdId: string },
) {
	const submission = parseWithZod(formData, { schema: ImportUrlSchema })
	if (submission.status !== 'success') {
		return data(
			{
				intent: 'fetch' as const,
				error: 'Please enter a valid URL.',
				recipe: null,
				result: submission.reply(),
				duplicates: null,
			},
			{ status: 400 },
		)
	}

	const { url } = submission.value

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
			return data(
				{
					intent: 'fetch' as const,
					error:
						'This URL cannot be imported. Please use a public HTTP(S) URL.',
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
			)
		}

		// Don't cancel the unread body here: in Bun, cancelling a body that was
		// never read pulls all of it into memory. The abort in `finally`
		// releases the connection instead.
		if (!response.ok) {
			return data(
				{
					intent: 'fetch' as const,
					error: `Failed to fetch URL (${response.status})`,
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
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
			return data(
				{
					intent: 'fetch' as const,
					error:
						'No recipe data found on this page. The site may not use structured recipe data (JSON-LD).',
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
			)
		}

		let recipe
		try {
			recipe = extractRecipe(recipeData, url)
		} catch (error) {
			if (!(error instanceof RecipeShapeError)) throw error
			return data(
				{
					intent: 'fetch' as const,
					error: 'The recipe data on this page could not be read.',
					recipe: null,
					result: null,
					duplicates: null,
				},
				{ status: 400 },
			)
		}

		// Check for duplicates
		const duplicates: DuplicateMatch[] = []

		const urlMatches = await prisma.recipe.findMany({
			where: { householdId, sourceUrl: url },
			select: { id: true, title: true, sourceUrl: true },
		})
		for (const match of urlMatches) {
			duplicates.push({ ...match, matchReason: 'same-url' })
		}

		const urlMatchIds = new Set(urlMatches.map((m) => m.id))
		const titleMatches = await prisma.recipe.findMany({
			where: {
				householdId,
				title: { equals: recipe.title },
				id: { notIn: [...urlMatchIds] },
			},
			select: { id: true, title: true, sourceUrl: true },
		})
		for (const match of titleMatches) {
			duplicates.push({ ...match, matchReason: 'similar-title' })
		}

		return data({
			intent: 'fetch' as const,
			recipe,
			error: null,
			result: null,
			duplicates: duplicates.length > 0 ? duplicates : null,
		})
	} catch (error) {
		const message =
			error instanceof BodyTooLargeError
				? 'Page is too large to import.'
				: error instanceof UnsupportedEncodingError
					? 'The site sent the page in an encoding that cannot be imported.'
					: error instanceof Error && error.name === 'AbortError'
						? 'Request timed out. The site took too long to respond.'
						: 'Failed to fetch the URL. Please check the address and try again.'
		return data(
			{
				intent: 'fetch' as const,
				error: message,
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
		)
	} finally {
		clearTimeout(timeout)
		// Releases the page's connection. Bun keeps downloading a body that
		// was cancelled or left unread until its request is aborted.
		controller.abort()
	}
}
