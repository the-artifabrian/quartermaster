import { verifyUserPassword } from './auth.server.ts'

/**
 * Wrong passwords a signed-in user may type in a rolling hour, across
 * changing the password and adding a passkey. Only someone holding a session
 * for the account can use these up, so a stranger can't lock the owner out.
 * Sign-in has no per-account count for that reason; it is limited per
 * address in `server/rate-limit.ts`.
 */
export const SIGNED_IN_PASSWORD_LIMIT = 10
export const SIGNED_IN_PASSWORD_WINDOW_MS = 60 * 60 * 1000
export const MAX_TRACKED_USERS = 1000

export const TOO_MANY_WRONG_PASSWORDS =
	'Too many wrong passwords. Try again in an hour.'

// When each wrong password was typed, by user id. Kept in memory, since
// production runs one machine. A restart forgets the counts, so a user near
// the limit gets ten more tries. When the map is full, the user under the
// limit whose last wrong password is oldest makes room. A user at the limit
// is never dropped, and if every user kept is at the limit, a new user is
// refused as if limited until counts expire.
const wrongPasswords = new Map<string, number[]>()

/** How many users have a count kept. For tests. */
export function trackedUserCount() {
	return wrongPasswords.size
}

function forgetExpired(now: number) {
	for (const [userId, times] of wrongPasswords) {
		const recent = times.filter((t) => now - t < SIGNED_IN_PASSWORD_WINDOW_MS)
		if (recent.length === 0) wrongPasswords.delete(userId)
		else if (recent.length !== times.length) wrongPasswords.set(userId, recent)
	}
}

/**
 * Frees a place for a new user if the map is full, by dropping the user under
 * the limit whose last wrong password is oldest. False when every user kept
 * is at the limit.
 */
function makeRoom() {
	if (wrongPasswords.size < MAX_TRACKED_USERS) return true
	for (const [userId, times] of wrongPasswords) {
		if (times.length < SIGNED_IN_PASSWORD_LIMIT) {
			wrongPasswords.delete(userId)
			return true
		}
	}
	return false
}

/**
 * Checks the password of a user who is already signed in. Past the limit it
 * answers `limited` without running bcrypt. A right password clears the count.
 */
export async function checkSignedInPassword(
	userId: string,
	password: string,
): Promise<'ok' | 'wrong' | 'limited'> {
	const now = Date.now()
	forgetExpired(now)
	const times = wrongPasswords.get(userId) ?? []
	if (times.length >= SIGNED_IN_PASSWORD_LIMIT) return 'limited'
	if (!wrongPasswords.has(userId) && !makeRoom()) return 'limited'

	// The try is counted before bcrypt runs, so checks sent at once can't all
	// get past the limit while the first ones are still being compared. A
	// check that throws stays counted.
	times.push(now)
	wrongPasswords.delete(userId)
	wrongPasswords.set(userId, times)

	if (!(await verifyUserPassword({ id: userId }, password))) return 'wrong'
	wrongPasswords.delete(userId)
	return 'ok'
}
