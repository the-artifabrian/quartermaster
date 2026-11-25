import { expect, test } from 'vitest'
import { redactUrl } from './redact-url.ts'

// Nothing may let a code, token or email address through to a log line or an
// analytics event, or garble the parts we keep. A redacted parameter keeps its
// name, so the log still says what kind of request it was.

test.each([
	'code',
	'token',
	'target',
	'session_id',
	'otp',
	'state',
	'email',
	'password',
	'secret',
])('the value of %s is redacted', (name) => {
	expect(redactUrl(`/x?${name}=s3cr3t`)).toBe(`/x?${name}=redacted`)
})

test('everything else is kept as it was', () => {
	expect(
		redactUrl('/verify?type=onboarding&code=ABC123&redirectTo=%2Frecipes#top'),
	).toBe('/verify?type=onboarding&code=redacted&redirectTo=%2Frecipes#top')
	expect(redactUrl('/recipes?q=salt+%26+pepper&sort=new')).toBe(
		'/recipes?q=salt+%26+pepper&sort=new',
	)
	expect(redactUrl('/recipes')).toBe('/recipes')
	expect(redactUrl('')).toBe('')
})

test('absolute URLs keep their origin', () => {
	expect(redactUrl('https://useqm.app/verify?code=4/0Ab&state=xyz')).toBe(
		'https://useqm.app/verify?code=redacted&state=redacted',
	)
})

test('names match in any case and percent-encoded', () => {
	expect(redactUrl('/x?Code=1&TOKEN=2&co%64e=3')).toBe(
		'/x?Code=redacted&TOKEN=redacted&co%64e=redacted',
	)
})

test('repeated, empty and bare parameters', () => {
	expect(redactUrl('/x?token=a&token=b&flag&code=&n=1')).toBe(
		'/x?token=redacted&token=redacted&flag&code=redacted&n=1',
	)
})

test('a token inside an encoded redirectTo is redacted', () => {
	const once = redactUrl(
		'/login?redirectTo=%2Fhousehold%2Fjoin%3Ftoken%3Dinvite-abc',
	)
	expect(once).not.toContain('invite-abc')
	expect(decodeURIComponent(once)).toBe(
		'/login?redirectTo=/household/join?token=redacted',
	)

	const inner = encodeURIComponent('/household/join?token=invite-abc')
	const twice = redactUrl(
		`/login?redirectTo=${encodeURIComponent(`/verify?redirectTo=${inner}`)}`,
	)
	expect(twice).not.toContain('invite-abc')
	expect(decodeURIComponent(decodeURIComponent(twice))).toContain(
		'token=redacted',
	)
})

test('a token inside an unencoded redirectTo is redacted', () => {
	const url = redactUrl('/login?redirectTo=/household/join?token=invite-abc')
	expect(url).not.toContain('invite-abc')
	expect(url).toContain('redirectTo=')
})

test('a malformed escape does not throw or stop redaction', () => {
	expect(() => redactUrl('/x?%E0%A4%A=1&code=ABC')).not.toThrow()
	expect(redactUrl('/x?q=%E0%A4%A&code=ABC')).toBe(
		'/x?q=%E0%A4%A&code=redacted',
	)
	expect(redactUrl('/x?redirectTo=%2F%E0%A4%A%3Fcode%3DABC')).not.toContain(
		'ABC',
	)
})

test('an email address in target is gone', () => {
	const url = redactUrl(
		'https://useqm.app/verify?type=onboarding&target=ada%40example.com&code=Q2W3E4',
	)
	expect(url).not.toMatch(/example\.com|ada|Q2W3E4/)
})
