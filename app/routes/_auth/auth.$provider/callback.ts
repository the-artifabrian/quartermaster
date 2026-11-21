import { redirect } from 'react-router'
import {
	authenticator,
	getSessionExpirationDate,
	getUserId,
} from '#app/utils/auth.server.ts'
import { ProviderNameSchema, providerLabels } from '#app/utils/connections.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import { combineHeaders } from '#app/utils/misc.tsx'
import {
	normalizeEmail,
	normalizeUsername,
} from '#app/utils/providers/provider.ts'
import {
	destroyRedirectToHeader,
	getRedirectCookieValue,
} from '#app/utils/redirect-cookie.server.ts'
import {
	createToastHeaders,
	redirectWithToast,
} from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { handleNewSession } from '../login.server.ts'
import { prefilledProfileKey, providerIdKey } from '../onboarding/$provider.tsx'
import { setOnboardingEmail } from '../onboarding/onboarding-email.server.ts'
import { type Route } from './+types/callback.ts'

const destroyRedirectTo = { 'set-cookie': destroyRedirectToHeader }

export async function loader({ request, params }: Route.LoaderArgs) {
	// this loader performs mutations, so we need to make sure we're on the
	// primary instance to avoid writing to a read-only replica
	await ensurePrimary()

	const providerName = ProviderNameSchema.parse(params.provider)
	const redirectTo = getRedirectCookieValue(request)
	const label = providerLabels[providerName]

	const authResult = await authenticator
		.authenticate(providerName, request)
		.then(
			(data) =>
				({
					success: true,
					data,
				}) as const,
			(error) =>
				({
					success: false,
					error,
				}) as const,
		)

	if (!authResult.success) {
		console.error(authResult.error)
		throw await redirectWithToast(
			'/login',
			{
				title: 'Auth Failed',
				description: `There was an error authenticating with ${label}.`,
				type: 'error',
			},
			{ headers: destroyRedirectTo },
		)
	}

	const { data: profile } = authResult

	const existingConnection = await prisma.connection.findUnique({
		select: { userId: true },
		where: {
			providerName_providerId: {
				providerName,
				providerId: String(profile.id),
			},
		},
	})

	const userId = await getUserId(request)

	if (existingConnection && userId) {
		if (existingConnection.userId === userId) {
			return redirectWithToast(
				'/settings/profile/connections',
				{
					title: 'Already Connected',
					description: `Your "${profile.username}" ${label} account is already connected.`,
				},
				{ headers: destroyRedirectTo },
			)
		} else {
			return redirectWithToast(
				'/settings/profile/connections',
				{
					title: 'Already Connected',
					description: `The "${profile.username}" ${label} account is already connected to another account.`,
				},
				{ headers: destroyRedirectTo },
			)
		}
	}

	// Google sign-in is going away (#439), so a signed-in account can't add a
	// new connection. Existing connections still sign in below.
	if (userId) {
		return redirectWithToast(
			'/settings/profile/connections',
			{
				title: 'Not connected',
				description: `${label} sign-in is going away, so new ${label} connections are turned off.`,
			},
			{ headers: destroyRedirectTo },
		)
	}

	// Connection exists already? Make a new session
	if (existingConnection) {
		return makeSession({ request, userId: existingConnection.userId })
	}

	// if the email matches a user in the db, then link the account and
	// make a new session, but only for an email the provider has verified
	const user = await prisma.user.findUnique({
		select: { id: true },
		where: { email: profile.email.toLowerCase() },
	})
	if (user && !profile.emailVerified) {
		throw await redirectWithToast(
			'/login',
			{
				type: 'error',
				title: 'Log in with your password',
				description: `${label} hasn’t confirmed this email address, so it wasn’t linked to your account.`,
			},
			{ headers: destroyRedirectTo },
		)
	}
	if (user) {
		await prisma.connection.create({
			data: {
				providerName,
				providerId: String(profile.id),
				userId: user.id,
			},
		})
		return makeSession(
			{ request, userId: user.id },
			{
				headers: await createToastHeaders({
					title: 'Connected',
					description: `Your "${profile.username}" ${label} account has been connected.`,
				}),
			},
		)
	}

	// this is a new user, so let's get them onboarded
	const verifySession = await verifySessionStorage.getSession()
	setOnboardingEmail(verifySession, profile.email)
	verifySession.set(prefilledProfileKey, {
		...profile,
		email: normalizeEmail(profile.email),
		username:
			typeof profile.username === 'string'
				? normalizeUsername(profile.username)
				: undefined,
	})
	verifySession.set(providerIdKey, profile.id)
	const onboardingRedirect = [
		`/onboarding/${providerName}`,
		redirectTo ? new URLSearchParams({ redirectTo }) : null,
	]
		.filter(Boolean)
		.join('?')
	return redirect(onboardingRedirect, {
		headers: combineHeaders(
			{ 'set-cookie': await verifySessionStorage.commitSession(verifySession) },
			destroyRedirectTo,
		),
	})
}

async function makeSession(
	{
		request,
		userId,
		redirectTo,
	}: { request: Request; userId: string; redirectTo?: string | null },
	responseInit?: ResponseInit,
) {
	redirectTo ??= '/'
	const session = await prisma.session.create({
		select: { id: true, expirationDate: true, userId: true },
		data: {
			expirationDate: getSessionExpirationDate(),
			userId,
		},
	})
	return handleNewSession(
		{ request, session, redirectTo, remember: true },
		{ headers: combineHeaders(responseInit?.headers, destroyRedirectTo) },
	)
}
