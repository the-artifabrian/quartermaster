import { test as base, type Response } from '@playwright/test'
import { href, type Register } from 'react-router'
import * as setCookieParser from 'set-cookie-parser'
import { type User as UserModel } from '#app/generated/prisma/client.ts'
import {
	createOwnHousehold,
	getPasswordHash,
	getSessionExpirationDate,
	sessionKey,
} from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { MOCK_CODE_GOOGLE_HEADER } from '#app/utils/providers/constants.ts'
import { normalizeEmail } from '#app/utils/providers/provider.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { createUser } from './db-utils.ts'
import {
	type GoogleUser,
	deleteGoogleUser,
	insertGoogleUser,
} from './mocks/google.ts'

export * from './db-utils.ts'

type GetOrInsertUserOptions = {
	id?: string
	username?: UserModel['username']
	password?: string
	email?: UserModel['email']
}

type User = {
	id: string
	email: string
	username: string
	name: string | null
}

type LoggedInUser = User & { householdId: string }

async function getOrInsertUser({
	id,
	username,
	password,
	email,
}: GetOrInsertUserOptions = {}): Promise<User> {
	const select = { id: true, email: true, username: true, name: true }
	if (id) {
		return await prisma.user.findUniqueOrThrow({
			select,
			where: { id: id },
		})
	} else {
		const userData = createUser()
		username ??= userData.username
		password ??= userData.username
		email ??= userData.email
		return await prisma.user.create({
			select,
			data: {
				...userData,
				email,
				username,
				roles: { connect: { name: 'user' } },
				password: { create: { hash: await getPasswordHash(password) } },
			},
		})
	}
}

export type AppPages = keyof Register['pages']

export const test = base.extend<{
	navigate: <Path extends AppPages>(
		...args: Parameters<typeof href<Path>>
	) => Promise<null | Response>
	insertNewUser(options?: GetOrInsertUserOptions): Promise<User>
	login(options?: GetOrInsertUserOptions): Promise<LoggedInUser>
	prepareGoogleUser(): Promise<GoogleUser>
}>({
	navigate: async ({ page }, use) => {
		await use((...args) => {
			return page.goto(href(...args))
		})
	},
	// Inserts a user with no Household and no session. Production can't make
	// that user, since signup always creates a Household, so give them one
	// with `createOwnHousehold` before they sign in through the UI.
	insertNewUser: async ({}, use) => {
		let userId: string | undefined = undefined
		await use(async (options) => {
			const user = await getOrInsertUser(options)
			userId = user.id
			return user
		})
		// A failed `getOrInsertUser` leaves `userId` undefined. Prisma drops an
		// undefined filter, so an unguarded delete would reach every user in the
		// database rather than none.
		if (userId) {
			await prisma.user.delete({ where: { id: userId } }).catch(() => {})
		}
	},
	// Signs a user in and returns them with the id of their Household. A new
	// user gets a Household the way signup gives one. `{ id }` signs in an
	// existing user in the Household they already belong to, and creates one
	// only if they have none. Seed data into `householdId`; a test that creates
	// another Household for this user gives them two memberships.
	login: async ({ page }, use) => {
		const createdUserIds: Array<string> = []
		const createdHouseholdIds: Array<string> = []
		await use(async (options) => {
			const user = await getOrInsertUser(options)
			if (!options?.id) createdUserIds.push(user.id)
			const membership = options?.id
				? await prisma.householdMember.findFirst({
						where: { userId: user.id },
						select: { householdId: true },
					})
				: null
			let householdId = membership?.householdId
			if (!householdId) {
				householdId = (await createOwnHousehold(prisma, user)).id
				createdHouseholdIds.push(householdId)
			}
			const session = await prisma.session.create({
				data: {
					expirationDate: getSessionExpirationDate(),
					userId: user.id,
				},
				select: { id: true },
			})

			const authSession = await authSessionStorage.getSession()
			authSession.set(sessionKey, session.id)
			const cookieConfig = setCookieParser.parseString(
				await authSessionStorage.commitSession(authSession),
			)
			if (!cookieConfig) throw new Error('Failed to parse session cookie')
			const newConfig = {
				...cookieConfig,
				name: cookieConfig.name,
				value: cookieConfig.value,
				domain: 'localhost',
				expires: cookieConfig.expires?.getTime(),
				sameSite: cookieConfig.sameSite as 'Strict' | 'Lax' | 'None',
			}
			await page.context().addCookies([newConfig])
			return { ...user, householdId }
		})
		// Close the page first, so live refresh and revalidation send no new
		// requests for the rows the deletes below remove. A request the server
		// already has still runs, and can log a foreign key error.
		await page.close()
		await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
		await prisma.household.deleteMany({
			where: { id: { in: createdHouseholdIds } },
		})
	},
	prepareGoogleUser: async ({ page }, use, testInfo) => {
		await page.route(/\/auth\/google(?!\/callback)/, async (route, request) => {
			const headers = {
				...request.headers(),
				[MOCK_CODE_GOOGLE_HEADER]: testInfo.testId,
			}
			await route.continue({ headers })
		})

		let googleUser: GoogleUser | null = null
		await use(async () => {
			const newGoogleUser = await insertGoogleUser(testInfo.testId)!
			googleUser = newGoogleUser
			return newGoogleUser
		})

		const user = await prisma.user.findUnique({
			select: { id: true, name: true },
			where: { email: normalizeEmail(googleUser!.primaryEmail) },
		})
		if (user) {
			// Deleting the user leaves their Household behind. Delete it after the
			// user, so a request still arriving can't create another for them.
			const households = await prisma.household.findMany({
				where: { members: { some: { userId: user.id } } },
				select: { id: true },
			})
			await prisma.user.delete({ where: { id: user.id } })
			await prisma.session.deleteMany({ where: { userId: user.id } })
			await prisma.household.deleteMany({
				where: { id: { in: households.map((household) => household.id) } },
			})
		}
		await deleteGoogleUser(googleUser!.code)
	},
})
export const { expect } = test

/**
 * This allows you to wait for something (like an email to be available).
 *
 * It calls the callback every 50ms until it returns a value (and does not throw
 * an error). After the timeout, it will throw the last error that was thrown or
 * throw the error message provided as a fallback
 */
export async function waitFor<ReturnValue>(
	cb: () => ReturnValue | Promise<ReturnValue>,
	{
		errorMessage,
		timeout = 5000,
	}: { errorMessage?: string; timeout?: number } = {},
) {
	const endTime = Date.now() + timeout
	let lastError: unknown = new Error(errorMessage)
	while (Date.now() < endTime) {
		try {
			const response = await cb()
			if (response) return response
		} catch (e: unknown) {
			lastError = e
		}
		await new Promise((r) => setTimeout(r, 100))
	}
	throw lastError
}
