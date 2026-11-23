import {
	MaxFileSizeExceededError,
	parseFormData,
} from '@mjackson/form-data-parser'
import { expect, test } from 'vitest'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'
import {
	answerUnreadableFormWith400,
	formBodyMiddleware,
	rethrowUnreadableUpload,
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
// - a form read from a copy made with request.clone(), or a copy of a copy:
//   the copy answers 400 too
// - an empty urlencoded body still reads as an empty form, so the action's own
//   validation answers it
// - real forms, urlencoded and multipart with a file, still read in full
// - a body read twice is a bug in the action: it stays a TypeError, so it
//   still answers 500 and gets reported
// - JSON and text routes (passkeys, undo, the Stripe webhook) read the body
//   with json() or text(), which must work as before
// - the middleware hands the request on and returns the route's response
// - a body sent as a form (urlencoded or multipart) that still fails to read
//   may be a parser bug, so it leaves one warning with the error and the
//   content type, and nothing from the body or the query string. A missing
//   or other content type is a client sending the wrong thing and stays quiet
//
// Failure list for uploads (new and edited Recipes, Recipe import, voice
// input), which stream multipart through @mjackson/form-data-parser and never
// call request.formData() for it:
// - multipart with no boundary, or a stream cut short: the parser's own
//   MultipartParseError must answer the same 400, with the same warning
// - a file over the size limit keeps its MaxFileSizeExceededError, which each
//   route already turns into its own answer
// - any other error, a database failure say, is rethrown as it was
// - a non-multipart body sent to an upload route reaches request.formData()
//   and gets the 400 from the read above

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
	consoleWarn.mockImplementation(() => {})
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
	consoleWarn.mockImplementation(() => {})
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'multipart/form-data; boundary=x' },
	})
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

test('a form body that fails to read leaves one warning without the body or the query', async () => {
	consoleWarn.mockImplementation(() => {})
	const request = answerUnreadableFormWith400(
		new Request('https://useqm.app/login?code=Q2W3E4', {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data; boundary=x' },
			body: '--x\r\nContent-Disposition: form-data; name="email"\r\n\r\nada@example.com',
		}),
	)
	expect(await formError(request.formData())).toBe(400)
	expect(consoleWarn).toHaveBeenCalledTimes(1)
	const warning = consoleWarn.mock.calls[0]!.map(String).join(' ')
	expect(warning).toContain('multipart/form-data')
	expect(warning).not.toMatch(/ada@example\.com|Q2W3E4|boundary=x/)
})

test('a missing or wrong content type answers 400 without a warning', async () => {
	const none = post()
	const json = post({
		headers: { 'content-type': 'application/json' },
		body: '{}',
	})
	expect(await formError(none.formData())).toBe(400)
	expect(await formError(json.formData())).toBe(400)
	expect(consoleWarn).not.toHaveBeenCalled()
})

async function upload(init: RequestInit) {
	const request = answerUnreadableFormWith400(
		new Request('https://useqm.app/recipes/new', { method: 'POST', ...init }),
	)
	try {
		return await parseFormData(request, { maxFileSize: 10 }, () => undefined)
	} catch (error) {
		rethrowUnreadableUpload(error)
	}
}

async function uploadError(init: RequestInit) {
	const error: unknown = await upload(init).catch((error: unknown) => error)
	return error instanceof Response ? error.status : error
}

test('an upload with no boundary or cut short answers 400 and warns', async () => {
	consoleWarn.mockImplementation(() => {})
	const noBoundary = await uploadError({
		headers: { 'content-type': 'multipart/form-data' },
		body: 'image=soup',
	})
	const cutShort = await uploadError({
		headers: { 'content-type': 'multipart/form-data; boundary=x' },
		body: '--x\r\nContent-Disposition: form-data; name="title"\r\n\r\nSoup',
	})
	expect(noBoundary).toBe(400)
	expect(cutShort).toBe(400)
	expect(consoleWarn).toHaveBeenCalledTimes(2)
})

test('an upload over the size limit keeps its own error', async () => {
	const form = new FormData()
	form.set('image', new File(['a picture too big'], 'soup.png'))
	expect(await uploadError({ body: form })).toBeInstanceOf(
		MaxFileSizeExceededError,
	)
})

test('an upload that is not multipart gets the 400 from the form read', async () => {
	expect(await uploadError({ body: 'title=Soup' })).toBe(400)
})

test('any other error from an upload is rethrown as it was', () => {
	const failure = new Error('Database is locked')
	expect(() => rethrowUnreadableUpload(failure)).toThrow(failure)
})
