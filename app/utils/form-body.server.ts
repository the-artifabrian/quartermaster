import {
	MaxFileSizeExceededError,
	MultipartParseError,
} from '@mjackson/form-data-parser'
import { type MiddlewareFunction } from 'react-router'

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data']

/**
 * The 400 for a body that can't be read as a form. A client that sent no form
 * at all gets it quietly. A body sent as a form that still fails to read may
 * be a parser bug rather than a broken client, so that leaves one warning
 * with the error and the media type, and nothing from the body or the URL.
 */
function unreadableForm(error: unknown, contentType: string | null) {
	const mediaType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
	if (FORM_TYPES.includes(mediaType)) {
		const message = error instanceof Error ? error.message : String(error)
		console.warn(`Couldn't read a ${mediaType} body: ${message}`)
	}
	return new Response('This request needs a form body.', { status: 400 })
}

/**
 * request.formData() throws when the body can't be read as a form: no body at
 * all, a content type that isn't a form's, or a broken multipart body. Actions
 * read their form that way, so each of those requests used to answer 500 and
 * land in the error reports. This makes the read throw a 400 Response instead,
 * on the request and on any copy of it, so those actions need no check of
 * their own. Uploads parse multipart themselves; see rethrowUnreadableUpload.
 *
 * Bun throws a TypeError for some of these and a plain Error for a multipart
 * body cut short, so any failure of a first read counts. A second read of a
 * used body is a bug in the action, and an aborted request has nobody to
 * answer, so both keep their own error.
 */
export function answerUnreadableFormWith400(request: Request) {
	const readForm = request.formData.bind(request)
	const copy = request.clone.bind(request)

	request.formData = async () => {
		if (request.bodyUsed) return readForm()
		try {
			return await readForm()
		} catch (error) {
			if (request.signal.aborted) throw error
			throw unreadableForm(error, request.headers.get('content-type'))
		}
	}
	request.clone = () => answerUnreadableFormWith400(copy())

	return request
}

/** Runs for every route, so every form read through request.formData() gets the 400 above. */
export const formBodyMiddleware: MiddlewareFunction<Response> = (
	{ request },
	next,
) => {
	answerUnreadableFormWith400(request)
	return next()
}

/**
 * For the catch around parseFormData in an upload route. The parser reads
 * multipart itself, so a broken body throws its MultipartParseError there and
 * never reaches the request.formData() patch above. That gets the same 400.
 * A file over the size limit keeps its own error, which the route answers,
 * and anything else is rethrown as it was.
 */
export function rethrowUnreadableUpload(error: unknown): never {
	if (
		error instanceof MultipartParseError &&
		!(error instanceof MaxFileSizeExceededError)
	) {
		throw unreadableForm(error, 'multipart/form-data')
	}
	throw error
}
