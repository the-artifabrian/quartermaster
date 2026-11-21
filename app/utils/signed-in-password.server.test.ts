import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createPassword, createUser } from '#tests/db-utils.ts'
import { login } from './auth.server.ts'
import {
	MAX_TRACKED_USERS,
	SIGNED_IN_PASSWORD_LIMIT,
	SIGNED_IN_PASSWORD_WINDOW_MS,
	checkSignedInPassword,
	trackedUserCount,
} from './signed-in-password.server.ts'
import '#tests/setup/db-setup.ts'

// Failure list for the limit on password checks made while signed in
// (changing the password, adding a passkey). The route tests cover the two
// forms; these cover the counter itself.
// 1. Ten wrong passwords, then the right one. The right one is refused, and
//    bcrypt doesn't run for it.
// 2. One user's wrong passwords limit another user.
// 3. Wrong, wrong, right. The right password clears the count, so the next
//    wrong ones start from zero.
// 4. An hour after the wrong passwords, the limit is still on.
// 5. Refused checks push the limit further out, so "in an hour" isn't true.
// 6. Many checks arrive at once, all read the count before any bcrypt
//    finishes, and more than ten wrong passwords get checked in the hour.
// 7. The limit spills into sign-in, so a stranger could lock the owner out
//    of the sign-in form.
// 8. Every user who ever typed a wrong password stays in memory, so the map
//    grows without end.
// 9. The map fills with other users' wrong passwords, and a user who hit the
//    limit is dropped to make room, so their count starts over.
// 10. Every user in a full map is at the limit. A new user's check runs
//     anyway, untracked, so it has no limit at all.

const password = 'current-password-1234'

async function userWithPassword() {
	return prisma.user.create({
		data: { ...createUser(), password: { create: createPassword(password) } },
		select: { id: true, username: true },
	})
}

async function failTimes(userId: string, times: number) {
	for (let i = 0; i < times; i++) {
		expect(await checkSignedInPassword(userId, `wrong-${i}`)).toBe('wrong')
	}
}

beforeEach(() => {
	vi.spyOn(bcrypt, 'compare')
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

test('the right password after ten wrong ones is refused without checking it', async () => {
	const user = await userWithPassword()
	await failTimes(user.id, SIGNED_IN_PASSWORD_LIMIT)
	expect(bcrypt.compare).toHaveBeenCalledTimes(SIGNED_IN_PASSWORD_LIMIT)

	expect(await checkSignedInPassword(user.id, password)).toBe('limited')
	expect(bcrypt.compare).toHaveBeenCalledTimes(SIGNED_IN_PASSWORD_LIMIT)
})

test('one user’s wrong passwords don’t limit another user', async () => {
	const first = await userWithPassword()
	const second = await userWithPassword()
	await failTimes(first.id, SIGNED_IN_PASSWORD_LIMIT)

	expect(await checkSignedInPassword(second.id, password)).toBe('ok')
	expect(await checkSignedInPassword(second.id, 'wrong')).toBe('wrong')
})

test('the right password clears the count', async () => {
	const user = await userWithPassword()
	await failTimes(user.id, 2)
	expect(await checkSignedInPassword(user.id, password)).toBe('ok')

	await failTimes(user.id, SIGNED_IN_PASSWORD_LIMIT - 1)
	expect(await checkSignedInPassword(user.id, password)).toBe('ok')
})

test('the limit lifts an hour after the wrong passwords', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	const user = await userWithPassword()
	await failTimes(user.id, SIGNED_IN_PASSWORD_LIMIT)
	expect(await checkSignedInPassword(user.id, password)).toBe('limited')

	vi.setSystemTime(Date.now() + SIGNED_IN_PASSWORD_WINDOW_MS - 1000)
	expect(await checkSignedInPassword(user.id, password)).toBe('limited')

	vi.setSystemTime(Date.now() + 2000)
	expect(await checkSignedInPassword(user.id, password)).toBe('ok')
})

test('refused checks don’t push the limit further out', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	const user = await userWithPassword()
	await failTimes(user.id, SIGNED_IN_PASSWORD_LIMIT)

	vi.setSystemTime(Date.now() + SIGNED_IN_PASSWORD_WINDOW_MS / 2)
	for (let i = 0; i < SIGNED_IN_PASSWORD_LIMIT; i++) {
		expect(await checkSignedInPassword(user.id, 'wrong')).toBe('limited')
	}

	vi.setSystemTime(Date.now() + SIGNED_IN_PASSWORD_WINDOW_MS / 2 + 1000)
	expect(await checkSignedInPassword(user.id, password)).toBe('ok')
})

test('checks sent at once still stop at the limit', async () => {
	const user = await userWithPassword()

	const results = await Promise.all(
		Array.from({ length: 2 * SIGNED_IN_PASSWORD_LIMIT }, (_, i) =>
			checkSignedInPassword(user.id, `wrong-${i}`),
		),
	)

	expect(results.filter((r) => r === 'wrong')).toHaveLength(
		SIGNED_IN_PASSWORD_LIMIT,
	)
	expect(results.filter((r) => r === 'limited')).toHaveLength(
		SIGNED_IN_PASSWORD_LIMIT,
	)
	expect(bcrypt.compare).toHaveBeenCalledTimes(SIGNED_IN_PASSWORD_LIMIT)
})

test('sign-in still works for a user who hit the limit', async () => {
	const user = await userWithPassword()
	await failTimes(user.id, SIGNED_IN_PASSWORD_LIMIT)
	expect(await checkSignedInPassword(user.id, password)).toBe('limited')

	const session = await login({ username: user.username, password })
	expect(session).toMatchObject({ userId: user.id })
})

test('the counter keeps a bounded number of users', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	// Ids with no account fail without running bcrypt, which keeps this quick.
	for (let i = 0; i < MAX_TRACKED_USERS + 50; i++) {
		await checkSignedInPassword(`no-such-user-${i}`, 'wrong')
	}
	expect(trackedUserCount()).toBeLessThanOrEqual(MAX_TRACKED_USERS)

	// Counts past their hour go the next time anything is counted.
	vi.setSystemTime(Date.now() + SIGNED_IN_PASSWORD_WINDOW_MS + 1000)
	await checkSignedInPassword('no-such-user-later', 'wrong')
	expect(trackedUserCount()).toBe(1)
})

test('a full counter keeps the users who hit the limit', async () => {
	const user = await userWithPassword()
	await failTimes(user.id, SIGNED_IN_PASSWORD_LIMIT)

	for (let i = 0; i < MAX_TRACKED_USERS + 50; i++) {
		await checkSignedInPassword(`filler-${i}`, 'wrong')
	}

	expect(trackedUserCount()).toBeLessThanOrEqual(MAX_TRACKED_USERS)
	expect(await checkSignedInPassword(user.id, password)).toBe('limited')
})

test('when every user kept is at the limit, a new user is refused unchecked', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	// Start from an empty counter: earlier counts are past their hour.
	vi.setSystemTime(Date.now() + SIGNED_IN_PASSWORD_WINDOW_MS + 1000)
	for (let i = 0; i < MAX_TRACKED_USERS; i++) {
		for (let j = 0; j < SIGNED_IN_PASSWORD_LIMIT; j++) {
			await checkSignedInPassword(`limited-${i}`, 'wrong')
		}
	}
	expect(trackedUserCount()).toBe(MAX_TRACKED_USERS)
	const user = await userWithPassword()
	vi.mocked(bcrypt.compare).mockClear()

	expect(await checkSignedInPassword(user.id, password)).toBe('limited')
	expect(bcrypt.compare).not.toHaveBeenCalled()
	expect(trackedUserCount()).toBe(MAX_TRACKED_USERS)
})
