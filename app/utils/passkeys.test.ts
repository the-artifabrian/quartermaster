import { WebAuthnError } from '@simplewebauthn/browser'
import { afterEach, expect, test, vi } from 'vitest'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'
import {
	addPasskeyRetryWindowMs,
	isAddPasskeyRetryStale,
	isPasskeyPromptDismissed,
	isUnknownPasskeyAnswer,
	passkeyErrorName,
	signalAcceptedPasskeys,
	signalUnknownPasskey,
	supportsPasskeyAutofill,
	unknownPasskeyError,
} from './passkeys.ts'

// Failure list for the browser-side passkey helpers:
// 1. The browser has no PublicKeyCredential at all (an old browser, or the
//    server render). Autofill reports false and neither signal throws.
// 2. PublicKeyCredential exists without the Signal API (Firefox, Safari before
//    26). Both signals do nothing and don't throw.
// 3. getClientCapabilities says conditionalGet is false. No autofill, even
//    when isConditionalMediationAvailable would say yes.
// 4. getClientCapabilities is missing (iOS 16 to 17.3). The check falls back
//    to isConditionalMediationAvailable.
// 5. getClientCapabilities rejects. The check falls back instead of throwing.
// 6. A signal call rejects. The rejection is swallowed with a warning.
// 7. An id that isn't unpadded base64url. The signal is skipped, so the
//    browser can't throw a TypeError on page load.
// 8. A cancelled or timed-out prompt (NotAllowedError) and a prompt cancelled
//    by the app (AbortError) count as dismissed, also when SimpleWebAuthn
//    wraps them. InvalidStateError and other errors don't.
// 9. A sign-in answer counts as "unknown passkey" only as a 404 with the
//    route's own "Passkey not found" body. A 404 with another body (a proxy
//    page, a missing route), a 400 with that message, or a body that isn't
//    the route's JSON doesn't.
// 10. Another tap after an unfinished prompt is offered while the options are
//     fresh and stops before the server's five minutes run out. A clock that
//     went backwards counts as stale.

afterEach(() => {
	vi.unstubAllGlobals()
})

const handle = 'dXNlci0x'
const credentialId = 'Y3JlZC0x'

test('with no PublicKeyCredential, autofill is off and the signals do nothing', async () => {
	vi.stubGlobal('PublicKeyCredential', undefined)
	await expect(supportsPasskeyAutofill()).resolves.toBe(false)
	await expect(
		signalUnknownPasskey({ rpId: 'useqm.app', credentialId }),
	).resolves.toBeUndefined()
	await expect(
		signalAcceptedPasskeys({
			rpId: 'useqm.app',
			userId: handle,
			credentialIds: [credentialId],
		}),
	).resolves.toBeUndefined()
})

test('without the Signal API the signals do nothing', async () => {
	vi.stubGlobal('PublicKeyCredential', class {})
	await expect(
		signalUnknownPasskey({ rpId: 'useqm.app', credentialId }),
	).resolves.toBeUndefined()
	await expect(
		signalAcceptedPasskeys({
			rpId: 'useqm.app',
			userId: handle,
			credentialIds: [],
		}),
	).resolves.toBeUndefined()
})

test('the signals pass the server’s rpId and ids through', async () => {
	const signalUnknownCredential = vi.fn(async () => {})
	const signalAllAcceptedCredentials = vi.fn(async () => {})
	vi.stubGlobal('PublicKeyCredential', {
		signalUnknownCredential,
		signalAllAcceptedCredentials,
	})
	await signalUnknownPasskey({ rpId: 'useqm.app', credentialId })
	await signalAcceptedPasskeys({
		rpId: 'useqm.app',
		userId: handle,
		credentialIds: [credentialId],
	})
	expect(signalUnknownCredential).toHaveBeenCalledWith({
		rpId: 'useqm.app',
		credentialId,
	})
	expect(signalAllAcceptedCredentials).toHaveBeenCalledWith({
		rpId: 'useqm.app',
		userId: handle,
		allAcceptedCredentialIds: [credentialId],
	})
})

test('conditionalGet false turns autofill off', async () => {
	vi.stubGlobal('PublicKeyCredential', {
		getClientCapabilities: async () => ({ conditionalGet: false }),
		isConditionalMediationAvailable: async () => true,
	})
	await expect(supportsPasskeyAutofill()).resolves.toBe(false)
})

test('conditionalGet true turns autofill on', async () => {
	vi.stubGlobal('PublicKeyCredential', {
		getClientCapabilities: async () => ({ conditionalGet: true }),
		isConditionalMediationAvailable: async () => true,
	})
	await expect(supportsPasskeyAutofill()).resolves.toBe(true)
})

test('without getClientCapabilities, isConditionalMediationAvailable decides', async () => {
	vi.stubGlobal('PublicKeyCredential', {
		isConditionalMediationAvailable: async () => true,
	})
	await expect(supportsPasskeyAutofill()).resolves.toBe(true)
	vi.stubGlobal('PublicKeyCredential', {
		isConditionalMediationAvailable: async () => false,
	})
	await expect(supportsPasskeyAutofill()).resolves.toBe(false)
	vi.stubGlobal('PublicKeyCredential', class {})
	await expect(supportsPasskeyAutofill()).resolves.toBe(false)
})

test('a getClientCapabilities that rejects falls back instead of throwing', async () => {
	vi.stubGlobal('PublicKeyCredential', {
		getClientCapabilities: async () => {
			throw new Error('nope')
		},
		isConditionalMediationAvailable: async () => true,
	})
	await expect(supportsPasskeyAutofill()).resolves.toBe(true)
})

test('a signal that rejects is swallowed with a warning', async () => {
	consoleWarn.mockImplementation(() => {})
	vi.stubGlobal('PublicKeyCredential', {
		signalUnknownCredential: async () => {
			throw new DOMException('bad', 'SecurityError')
		},
		signalAllAcceptedCredentials: async () => {
			throw new DOMException('bad', 'SecurityError')
		},
	})
	await expect(
		signalUnknownPasskey({ rpId: 'useqm.app', credentialId }),
	).resolves.toBeUndefined()
	await expect(
		signalAcceptedPasskeys({
			rpId: 'useqm.app',
			userId: handle,
			credentialIds: [credentialId],
		}),
	).resolves.toBeUndefined()
	expect(consoleWarn).toHaveBeenCalledTimes(2)
})

test('ids that aren’t unpadded base64url skip the signal', async () => {
	consoleWarn.mockImplementation(() => {})
	const signalUnknownCredential = vi.fn(async () => {})
	const signalAllAcceptedCredentials = vi.fn(async () => {})
	vi.stubGlobal('PublicKeyCredential', {
		signalUnknownCredential,
		signalAllAcceptedCredentials,
	})
	await signalUnknownPasskey({ rpId: 'useqm.app', credentialId: 'cred=' })
	await signalAcceptedPasskeys({
		rpId: 'useqm.app',
		userId: handle,
		credentialIds: [credentialId, 'not base64'],
	})
	await signalAcceptedPasskeys({
		rpId: 'useqm.app',
		userId: 'a',
		credentialIds: [],
	})
	expect(signalUnknownCredential).not.toHaveBeenCalled()
	expect(signalAllAcceptedCredentials).not.toHaveBeenCalled()
})

test('a cancel, a timeout or an app abort counts as dismissed; other errors don’t', () => {
	const notAllowed = new DOMException('cancelled', 'NotAllowedError')
	const abort = Object.assign(new Error('Cancelling'), { name: 'AbortError' })
	const invalidState = new DOMException('exists', 'InvalidStateError')
	expect(isPasskeyPromptDismissed(notAllowed)).toBe(true)
	expect(isPasskeyPromptDismissed(abort)).toBe(true)
	expect(
		isPasskeyPromptDismissed(
			new WebAuthnError({
				message: 'cancelled',
				code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
				cause: notAllowed,
			}),
		),
	).toBe(true)
	expect(
		isPasskeyPromptDismissed(
			new WebAuthnError({
				message: 'aborted',
				code: 'ERROR_CEREMONY_ABORTED',
				cause: abort,
			}),
		),
	).toBe(true)
	expect(isPasskeyPromptDismissed(invalidState)).toBe(false)
	expect(
		passkeyErrorName(
			new WebAuthnError({
				message: 'The authenticator was previously registered',
				code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
				cause: invalidState,
			}),
		),
	).toBe('InvalidStateError')
	expect(isPasskeyPromptDismissed(new Error('Passkey not found'))).toBe(false)
	expect(isPasskeyPromptDismissed('NotAllowedError')).toBe(false)
	expect(isPasskeyPromptDismissed(null)).toBe(false)
})

test('only a 404 with the route’s own body means the passkey is unknown', () => {
	const body = { status: 'error', error: unknownPasskeyError }
	expect(isUnknownPasskeyAnswer(404, body)).toBe(true)
	expect(isUnknownPasskeyAnswer(400, body)).toBe(false)
	expect(
		isUnknownPasskeyAnswer(404, { status: 'error', error: 'Not Found' }),
	).toBe(false)
	expect(isUnknownPasskeyAnswer(404, { status: 'error' })).toBe(false)
	expect(isUnknownPasskeyAnswer(404, '<html>Not Found</html>')).toBe(false)
	expect(isUnknownPasskeyAnswer(404, null)).toBe(false)
})

test('another tap is offered only while the password check still holds', () => {
	const receivedAt = 1_000_000
	expect(isAddPasskeyRetryStale(receivedAt, receivedAt)).toBe(false)
	expect(
		isAddPasskeyRetryStale(
			receivedAt,
			receivedAt + addPasskeyRetryWindowMs - 1,
		),
	).toBe(false)
	expect(
		isAddPasskeyRetryStale(receivedAt, receivedAt + addPasskeyRetryWindowMs),
	).toBe(true)
	expect(addPasskeyRetryWindowMs).toBeLessThan(5 * 60 * 1000)
	expect(isAddPasskeyRetryStale(receivedAt, receivedAt - 1000)).toBe(true)
})
