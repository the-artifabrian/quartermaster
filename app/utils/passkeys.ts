// Browser-side passkey helpers. Everything newer than WebAuthn itself is
// feature-checked here: conditional mediation (passkey autofill) and the
// Signal API, which keeps the phone's passkey list in step with the server.
// Where a browser lacks one, the helper does nothing.

type PublicKeyCredentialExtras = {
	getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>
	isConditionalMediationAvailable?: () => Promise<boolean>
	signalUnknownCredential?: (options: {
		rpId: string
		credentialId: string
	}) => Promise<void>
	signalAllAcceptedCredentials?: (options: {
		rpId: string
		userId: string
		allAcceptedCredentialIds: string[]
	}) => Promise<void>
}

function publicKeyCredential(): PublicKeyCredentialExtras | null {
	const value = (globalThis as { PublicKeyCredential?: unknown })
		.PublicKeyCredential
	return value ? (value as PublicKeyCredentialExtras) : null
}

/** Unpadded base64url, which the Signal API checks in native code. */
function isBase64Url(value: string) {
	return value.length > 0 && value.length % 4 !== 1 && /^[\w-]+$/.test(value)
}

/** The DOMException name, also when SimpleWebAuthn has wrapped the error. */
export function passkeyErrorName(error: unknown) {
	return error instanceof Error ? error.name : null
}

/**
 * The person closed the passkey prompt or let it time out (NotAllowedError),
 * or the app cancelled it to start another (AbortError). Neither is worth an
 * error message.
 */
export function isPasskeyPromptDismissed(error: unknown) {
	const name = passkeyErrorName(error)
	return name === 'NotAllowedError' || name === 'AbortError'
}

/**
 * Whether focusing the username can offer a saved passkey. Safari 17.4 and
 * later answer through getClientCapabilities; iOS 16 and 17.0 to 17.3 only
 * have isConditionalMediationAvailable.
 */
export async function supportsPasskeyAutofill() {
	const pkc = publicKeyCredential()
	if (!pkc) return false
	if (pkc.getClientCapabilities) {
		try {
			const capabilities = await pkc.getClientCapabilities()
			return capabilities.conditionalGet === true
		} catch {
			// Fall through to the older check.
		}
	}
	if (!pkc.isConditionalMediationAvailable) return false
	try {
		return await pkc.isConditionalMediationAvailable()
	} catch {
		return false
	}
}

/** Sign-in found no such passkey on the server: the browser can drop it. */
export async function signalUnknownPasskey({
	rpId,
	credentialId,
}: {
	rpId: string
	credentialId: string
}) {
	const signal = publicKeyCredential()?.signalUnknownCredential
	if (!signal) return
	if (!isBase64Url(credentialId)) {
		console.warn('Skipped signalUnknownCredential: the id isn’t base64url')
		return
	}
	try {
		await signal.call(publicKeyCredential(), { rpId, credentialId })
	} catch (error) {
		console.warn('signalUnknownCredential failed', error)
	}
}

/**
 * The account's full list of passkeys, so the browser can drop any that were
 * deleted. Pass every passkey the account has: one left out is removed from
 * the person's passkey provider.
 */
export async function signalAcceptedPasskeys({
	rpId,
	userId,
	credentialIds,
}: {
	rpId: string
	userId: string
	credentialIds: string[]
}) {
	const signal = publicKeyCredential()?.signalAllAcceptedCredentials
	if (!signal) return
	if (!isBase64Url(userId) || !credentialIds.every(isBase64Url)) {
		console.warn('Skipped signalAllAcceptedCredentials: an id isn’t base64url')
		return
	}
	try {
		await signal.call(publicKeyCredential(), {
			rpId,
			userId,
			allAcceptedCredentialIds: credentialIds,
		})
	} catch (error) {
		console.warn('signalAllAcceptedCredentials failed', error)
	}
}
