import { type MiddlewareFunction } from 'react-router'

/**
 * request.formData() throws when the body can't be read as a form: no body at
 * all, a content type that isn't a form's, or a broken multipart body. Every
 * action reads its form that way, so each of those requests used to answer
 * 500 and land in the error reports. This makes the read throw a 400 Response
 * instead, on the request and on any copy of it, so no action needs a check of
 * its own.
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
			throw new Response('This request needs a form body.', { status: 400 })
		}
	}
	request.clone = () => answerUnreadableFormWith400(copy())

	return request
}

/** Runs for every route, so every action gets the 400 above. */
export const formBodyMiddleware: MiddlewareFunction<Response> = (
	{ request },
	next,
) => {
	answerUnreadableFormWith400(request)
	return next()
}
