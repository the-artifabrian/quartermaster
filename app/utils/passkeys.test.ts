import { WebAuthnError } from '@simplewebauthn/browser'
import { afterEach, expect, test, vi } from 'vitest'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'
import {
	isPasskeyPromptDismissed,
	passkeyErrorName,
	signalAcceptedPasskeys,
	signalUnknownPasskey,
	supportsPasskeyAutofill,
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
