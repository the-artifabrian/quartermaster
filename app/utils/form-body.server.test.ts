import { expect, test } from 'vitest'
import {
	answerUnreadableFormWith400,
	formBodyMiddleware,
} from './form-body.server.ts'

// Failure list for a request body that can't be read as a form:
// - a POST with no body and no content type: formData() throws, and the action
//   that called it answers 500. It must answer 400.
// - a body whose content type isn't a form's (text/plain, JSON): 400
// - multipart with no boundary, or a multipart body cut short: 400. Bun
//   reports a cut-short body as a plain Error where Node has a TypeError, so
//   the error's class can't decide it
// - a request the client gave up on keeps its own error; nobody is there to
//   read a 400, and the error report already skips aborted requests
// - a form read from a copy (Plan, Recipe import and the OAuth route read the
//   intent or redirectTo from request.clone() first): the copy answers 400 too
// - an empty urlencoded body still reads as an empty form, so the action's own
//   validation answers it
// - real forms, urlencoded and multipart with a file, still read in full
// - a body read twice is a bug in the action: it stays a TypeError, so it
//   still answers 500 and gets reported
// - JSON and text routes (passkeys, undo, the Stripe webhook) read the body
//   with json() or text(), which must work as before
// - the middleware hands the request on and returns the route's response

const url = 'https://useqm.app/login'

function post(init: RequestInit = {}) {
	return answerUnreadableFormWith400(
		new Request(url, { method: 'POST', ...init }),
	)
}

async function formError(read: Promise<FormData>) {
	const error: unknown = await read.catch((error: unknown) => error)
	return error instanceof Response ? error.status : error
}

test('a POST with no body answers 400', async () => {
	expect(await formError(post().formData())).toBe(400)
})

test('a body that is not a form answers 400', async () => {
	const plainText = post({
		headers: { 'content-type': 'text/plain' },
		body: 'email=ada@example.com',
	})
	const json = post({
		headers: { 'content-type': 'application/json' },
		body: '{"email":"ada@example.com"}',
	})
	expect(await formError(plainText.formData())).toBe(400)
	expect(await formError(json.formData())).toBe(400)
})

test('a broken multipart body answers 400', async () => {
	const noBoundary = post({
		headers: { 'content-type': 'multipart/form-data' },
		body: 'email=ada@example.com',
	})
	const cutShort = post({
		headers: { 'content-type': 'multipart/form-data; boundary=x' },
		body: '--x\r\nContent-Disposition: form-data; name="email"\r\n\r\nada',
	})
	expect(await formError(noBoundary.formData())).toBe(400)
	expect(await formError(cutShort.formData())).toBe(400)
})

test('a plain Error from the parser answers 400 too, as Bun throws one', async () => {
	const request = new Request(url, { method: 'POST' })
	request.formData = () =>
		Promise.reject(new Error('FormData missing final boundary'))
	answerUnreadableFormWith400(request)
	expect(await formError(request.formData())).toBe(400)
})

test('an aborted request keeps its own error', async () => {
	const controller = new AbortController()
	const request = new Request(url, {
		method: 'POST',
		signal: controller.signal,
	})
	const aborted = new DOMException('The client went away', 'AbortError')
	request.formData = () => Promise.reject(aborted)
	answerUnreadableFormWith400(request)
	controller.abort()
	expect(await formError(request.formData())).toBe(aborted)
})

test('a copy of the request answers 400 too, and so does a copy of a copy', async () => {
	const request = post()
	expect(await formError(request.clone().formData())).toBe(400)
	expect(await formError(request.clone().clone().formData())).toBe(400)
	expect(await formError(request.formData())).toBe(400)
})

test('an empty urlencoded body reads as an empty form', async () => {
	const formData = await post({
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: '',
	}).formData()
	expect([...formData.keys()]).toEqual([])
})

test('real forms still read in full, from the request and from a copy', async () => {
	const urlencoded = post({
		body: new URLSearchParams({ email: 'ada@example.com', remember: 'on' }),
	})
	expect(Object.fromEntries(await urlencoded.clone().formData())).toMatchObject(
		{ email: 'ada@example.com' },
	)
	expect(Object.fromEntries(await urlencoded.formData())).toEqual({
		email: 'ada@example.com',
		remember: 'on',
	})

	const form = new FormData()
	form.set('intent', 'extract-image')
	form.set('image', new File(['png'], 'soup.png', { type: 'image/png' }))
	const multipart = await post({ body: form }).formData()
	expect(multipart.get('intent')).toBe('extract-image')
	expect(await (multipart.get('image') as File).text()).toBe('png')
})

test('reading a body twice stays an error, not a 400', async () => {
	const request = post({ body: new URLSearchParams({ email: 'a@b.c' }) })
	await request.formData()
	const second = await formError(request.formData())
	expect(second).toBeInstanceOf(TypeError)
})

test('json() and text() read the body as before', async () => {
	const json = post({
		headers: { 'content-type': 'application/json' },
		body: '{"id":"abc"}',
	})
	const text = post({ body: 'raw webhook payload' })
	expect(await json.json()).toEqual({ id: 'abc' })
	expect(await text.text()).toBe('raw webhook payload')
})

test('the middleware passes the request on and returns the route response', async () => {
	const request = new Request(url, { method: 'POST' })
	const routeResponse = new Response('ok')
	const response = await formBodyMiddleware(
		{ request, params: {}, context: {} } as unknown as Parameters<
			typeof formBodyMiddleware
		>[0],
		async () => routeResponse,
	)
	expect(response).toBe(routeResponse)
	expect(await formError(request.formData())).toBe(400)
})
