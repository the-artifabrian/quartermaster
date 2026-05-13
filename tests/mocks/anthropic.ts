import { http, passthrough, type HttpHandler } from 'msw'

const passthroughAnthropic = process.env.NODE_ENV !== 'test'

export const handlers: Array<HttpHandler> = passthroughAnthropic
	? [http.post('https://api.anthropic.com/v1/messages', () => passthrough())]
	: []
