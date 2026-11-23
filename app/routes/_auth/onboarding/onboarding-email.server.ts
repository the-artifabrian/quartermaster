import { type Session } from 'react-router'

/**
 * The address a signup has verified by an emailed code, waiting in the
 * verify cookie for the signup form. It works for 10 minutes,
 * like the cookie itself; the server checks the time so a kept copy of the
 * cookie can't outlast it.
 */
const onboardingEmailKey = 'onboardingEmail'
const onboardingEmailExpiresAtKey = 'onboardingEmailExpiresAt'
const ONBOARDING_EMAIL_LIFETIME_MS = 10 * 60 * 1000

export function setOnboardingEmail(verifySession: Session, email: string) {
	verifySession.set(onboardingEmailKey, email)
	verifySession.set(
		onboardingEmailExpiresAtKey,
		Date.now() + ONBOARDING_EMAIL_LIFETIME_MS,
	)
}

/** The verified address, or null when there is none or it has run out. */
export function getOnboardingEmail(verifySession: Session) {
	const email: unknown = verifySession.get(onboardingEmailKey)
	const expiresAt: unknown = verifySession.get(onboardingEmailExpiresAtKey)
	if (typeof email !== 'string' || !email) return null
	if (typeof expiresAt !== 'number' || expiresAt <= Date.now()) return null
	return email
}
