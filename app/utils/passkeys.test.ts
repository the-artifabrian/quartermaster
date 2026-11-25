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

// The browser-side passkey helpers.

afterEach(() => {
	vi.unstubAllGlobals()
})

const handle = 'dXNlci0x'
const credentialId = 'Y3JlZC0x'

// An old browser, or the server render.
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

// Firefox, and Safari before 26.
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

// iOS 16 to 17.3 has no getClientCapabilities.
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

// Skipping the signal keeps the browser from throwing a TypeError on page load.
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

// The window ends before the server's five minutes run out, and a clock that
// went backwards counts as stale.
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
