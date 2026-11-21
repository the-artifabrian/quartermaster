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

/** The sign-in error for a passkey the server has no record of. */
export const unknownPasskeyError = 'Passkey not found'

/**
 * Whether a sign-in answer says the server has no record of the passkey,
 * which lets the page tell the browser to forget it. Only a 404 carrying the
 * sign-in route's own error counts; a 404 page from a proxy doesn't.
 */
export function isUnknownPasskeyAnswer(status: number, body: unknown) {
	return (
		status === 404 &&
		typeof body === 'object' &&
		body !== null &&
		'status' in body &&
		body.status === 'error' &&
		'error' in body &&
		body.error === unknownPasskeyError
	)
}

/**
 * How long Settings offers another tap after a passkey prompt didn't finish.
 * The server's password check lasts five minutes from when it sent the
 * options; this stops 30 seconds short, so a tap never makes a passkey the
 * server will refuse.
 */
export const addPasskeyRetryWindowMs = 4.5 * 60 * 1000

/** Whether options that arrived at `receivedAt` are too old to try again. */
export function isAddPasskeyRetryStale(receivedAt: number, now: number) {
	const age = now - receivedAt
	return age < 0 || age >= addPasskeyRetryWindowMs
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
