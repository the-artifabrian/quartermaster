// Reads the export file from the restore form and checks its JSON text.

import {
	BodyTooLargeError,
	readBoundedText,
} from '#app/utils/bounded-body.server.ts'
import {
	FILE_TOO_BIG,
	RESTORE_LIMITS,
	RESTORE_MAX_FILE_BYTES,
} from './+export-format.ts'

// Room for the multipart boundary and part headers around the file. The form
// sends the file itself as the part, so its bytes arrive unchanged.
const RESTORE_MAX_BODY_BYTES = RESTORE_MAX_FILE_BYTES + 16 * 1024

// A tab still running the page from before the form sent multipart posts the
// old encoding.
const OLD_PAGE = 'This page is out of date. Reload the page and try again.'
const NO_FILE = 'No import data provided'

/**
 * Reads the export file from the form, refusing one over the cap before
 * anything parses it. Nothing but multipart is accepted, since urlencoding
 * can triple the size.
 */
export async function readRestoreFile(
	request: Request,
): Promise<{ text: string } | { error: string; status: number }> {
	const contentType = request.headers.get('Content-Type') ?? ''
	if (!contentType.startsWith('multipart/form-data')) {
		return { error: OLD_PAGE, status: 400 }
	}
	if (Number(request.headers.get('Content-Length')) > RESTORE_MAX_BODY_BYTES) {
		return { error: FILE_TOO_BIG, status: 413 }
	}
	let body: string
	try {
		// A Content-Length is only a claim, so the bytes are counted as they
		// arrive too.
		body = await readBoundedText(new Response(request.body), {
			maxBytes: RESTORE_MAX_BODY_BYTES,
			signal: request.signal,
			encoded: false,
		})
	} catch (error) {
		if (error instanceof BodyTooLargeError) {
			return { error: FILE_TOO_BIG, status: 413 }
		}
		throw error
	}
	let formData: FormData
	try {
		formData = await new Response(body, {
			headers: { 'Content-Type': contentType },
		}).formData()
	} catch {
		return { error: NO_FILE, status: 400 }
	}
	const file = formData.get('importData')
	if (file == null) return { error: NO_FILE, status: 400 }
	const text = typeof file === 'string' ? file : await file.text()
	if (Buffer.byteLength(text) > RESTORE_MAX_FILE_BYTES) {
		return { error: FILE_TOO_BIG, status: 413 }
	}
	return { text }
}

// Bounds on the shape of the JSON text, checked before JSON.parse builds it.
// The deepest a real export nests is about 11 levels. The other two allow
// twice and four times every object a file within RESTORE_LIMITS holds,
// which leaves room for the lists without a total of their own. The largest
// Household in production is far below both.
const RESTORE_LIMITS_TOTAL =
	RESTORE_LIMITS.recipeLines +
	RESTORE_LIMITS.menuCards +
	RESTORE_LIMITS.meals +
	RESTORE_LIMITS.mealCards +
	RESTORE_LIMITS.shoppingItems +
	2 * RESTORE_LIMITS.shoppingMealLinks
export const RESTORE_JSON_LIMITS = {
	depth: 16,
	containers: 2 * RESTORE_LIMITS_TOTAL,
	separators: 4 * RESTORE_LIMITS_TOTAL,
}
const TOO_COMPLEX =
	'This file holds far more than a Quartermaster export can, so it can’t be restored.'

/**
 * Scans the JSON text for its nesting depth and its count of objects, arrays
 * and commas, without parsing it. JSON.parse builds every value before the
 * schema sees any of them, so a file of nested empty brackets near the size
 * cap would build millions of objects.
 */
export function jsonShapeError(text: string) {
	let depth = 0
	let containers = 0
	let separators = 0
	let inString = false
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i)
		if (inString) {
			if (char === 0x5c)
				i++ // a backslash escapes the next character
			else if (char === 0x22) inString = false
		} else if (char === 0x22) {
			inString = true
		} else if (char === 0x7b || char === 0x5b) {
			depth++
			containers++
			if (
				depth > RESTORE_JSON_LIMITS.depth ||
				containers > RESTORE_JSON_LIMITS.containers
			) {
				return TOO_COMPLEX
			}
		} else if (char === 0x7d || char === 0x5d) {
			depth--
		} else if (char === 0x2c) {
			separators++
			if (separators > RESTORE_JSON_LIMITS.separators) return TOO_COMPLEX
		}
	}
	return null
}
