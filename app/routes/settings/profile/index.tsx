import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { settingsRootNav } from '#app/utils/nav-back.ts'
import { useEffect, useState } from 'react'
import { Form, useFetcher } from 'react-router'
import { ConfirmSheet } from '#app/components/ui/confirm-sheet.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { Switch } from '#app/components/ui/switch.tsx'
import { ThemeSwitch } from '#app/routes/resources/theme-switch.tsx'
import {
	type AccountDeletionOutcome,
	deleteAccount,
	getAccountDeletionOutcome,
} from '#app/utils/account-deletion.server.ts'
import { requireUserId, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { useIsNativeShell, useRequestInfo } from '#app/utils/request-info.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import {
	getKeepAwakePreference,
	setKeepAwakePreference,
} from '#app/utils/wake-lock.ts'
import { type Route } from './+types/index.ts'
import { twoFAVerificationType } from './two-factor/_layout.tsx'
import { PushLink } from '#app/components/push-link.tsx'

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: settingsRootNav,
}

const signOutOfSessionsActionIntent = 'sign-out-of-sessions'
const deleteDataActionIntent = 'delete-data'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		select: {
			id: true,
			name: true,
			username: true,
			email: true,
			_count: {
				select: {
					sessions: {
						where: {
							expirationDate: { gt: new Date() },
						},
					},
				},
			},
		},
	})

	const twoFactorVerification = await prisma.verification.findUnique({
		select: { id: true },
		where: { target_type: { type: twoFAVerificationType, target: userId } },
	})

	const [password, tierInfo, deletionOutcome] = await Promise.all([
		prisma.password.findUnique({
			select: { userId: true },
			where: { userId },
		}),
		getUserTier(userId),
		getAccountDeletionOutcome(userId),
	])

	return {
		user,
		hasPassword: Boolean(password),
		isTwoFactorEnabled: Boolean(twoFactorVerification),
		tierInfo,
		deletionOutcome,
	}
}

type ProfileActionArgs = {
	request: Request
	userId: string
	formData: FormData
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')
	switch (intent) {
		case signOutOfSessionsActionIntent: {
			return signOutOfSessionsAction({ request, userId, formData })
		}
		case deleteDataActionIntent: {
			return deleteDataAction({ request, userId, formData })
		}
		default: {
			throw new Response(`Invalid intent "${intent}"`, { status: 400 })
		}
	}
}

export default function SettingsIndex({ loaderData }: Route.ComponentProps) {
	const { user, tierInfo } = loaderData
	const requestInfo = useRequestInfo()
	// The iOS app may not point at buying Pro (ADR 0001): the row shows the
	// tier but links nowhere and says nothing about subscribing.
	const isNativeShell = useIsNativeShell()
	const tierLabel = tierInfo.isProActive ? 'Pro' : 'Free'

	return (
		<div className="flex flex-col gap-6">
			{/* Profile Banner */}
			<PushLink
				to="edit"
				className="bg-muted/40 hover:bg-muted/60 flex items-center gap-4 rounded-lg p-4 transition-colors"
			>
				<div
					className="bg-accent/20 text-accent-foreground flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-bold"
					aria-hidden="true"
				>
					{(user.name ?? user.username).charAt(0).toUpperCase()}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium">{user.name ?? user.username}</p>
					<p className="text-muted-foreground truncate text-sm">{user.email}</p>
				</div>
				<Icon
					name="chevron-right"
					className="text-muted-foreground size-5 shrink-0"
				/>
			</PushLink>

			{/* General */}
			<SettingsSection label="General">
				<SettingsRow to="household" icon="home" label="Household" />
				<SettingsRow
					to={isNativeShell ? undefined : '/upgrade'}
					icon="sparkles"
					label={isNativeShell ? 'Tier' : 'Subscription'}
					badge={
						<span
							className={cn(
								'rounded-full px-2 py-0.5 text-xs font-medium',
								tierInfo.isProActive
									? 'bg-primary/10 text-primary'
									: 'bg-muted text-muted-foreground',
							)}
						>
							{tierLabel}
						</span>
					}
				/>
				<SettingsRow icon="sun" label="Theme">
					<ThemeSwitch userPreference={requestInfo.userPrefs.theme} />
				</SettingsRow>
				<SettingsRow icon="timer" label="Keep screen awake while cooking">
					<KeepAwakeSwitch />
				</SettingsRow>
			</SettingsSection>

			{/* Account */}
			<SettingsSection label="Account">
				<SettingsRow
					to="change-email"
					icon="envelope-closed"
					label="Email"
					value={user.email}
				/>
				<SettingsRow
					to={loaderData.hasPassword ? 'password' : 'password/create'}
					icon="dots-horizontal"
					label={loaderData.hasPassword ? 'Password' : 'Create Password'}
				/>
				<SettingsRow
					to="two-factor"
					icon={loaderData.isTwoFactorEnabled ? 'lock-closed' : 'lock-open-1'}
					label="Two-Factor Auth"
					value={loaderData.isTwoFactorEnabled ? 'On' : 'Off'}
				/>
			</SettingsSection>

			{/* Connections */}
			<SettingsSection label="Connections">
				<SettingsRow to="connections" icon="link-2" label="Connections" />
				<SettingsRow to="passkeys" icon="passkey" label="Passkeys" />
			</SettingsSection>

			{/* Data */}
			<SettingsSection label="Data">
				<SettingsRow to="import" icon="update" label="Import Data" />
				<SettingsRow
					href="/resources/export-all-data"
					download
					icon="download"
					label="Export All Data"
				/>
				<SettingsRow
					href="/resources/export-recipes"
					download
					icon="download"
					label="Export Recipes"
				/>
			</SettingsSection>

			{/* Log out */}
			<SettingsSection>
				<Form action="/logout" method="POST">
					<button
						type="submit"
						className="hover:bg-accent/5 flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left transition-colors"
					>
						<Icon
							name="exit"
							className="text-muted-foreground size-5 shrink-0"
						/>
						<span>Log out</span>
					</button>
				</Form>
			</SettingsSection>

			{/* Danger Zone */}
			<SettingsSection>
				<div className="px-4 py-3">
					<SignOutOfSessions loaderData={loaderData} />
				</div>
				<div className="px-4 py-3">
					<DeleteData outcome={loaderData.deletionOutcome} />
				</div>
			</SettingsSection>
		</div>
	)
}

function KeepAwakeSwitch() {
	// Device-local preference (localStorage), read after mount to avoid an SSR
	// mismatch — same pattern as the recipe page's Metric toggle.
	const [enabled, setEnabled] = useState(true)
	const [hydrated, setHydrated] = useState(false)
	useEffect(() => {
		setEnabled(getKeepAwakePreference())
		setHydrated(true)
	}, [])

	function handleChange(next: boolean) {
		setKeepAwakePreference(next)
		setEnabled(next)
	}

	return (
		<Switch
			checked={enabled}
			onCheckedChange={handleChange}
			aria-label="Keep screen awake while a recipe is open"
			disabled={!hydrated}
		/>
	)
}

function SettingsSection({
	label,
	children,
}: {
	label?: string
	children: React.ReactNode
}) {
	return (
		<div>
			{label ? (
				<h3 className="text-muted-foreground mb-1.5 px-1 text-xs font-semibold tracking-wider uppercase">
					{label}
				</h3>
			) : null}
			<div className="bg-muted/40 divide-border/50 divide-y overflow-hidden rounded-lg">
				{children}
			</div>
		</div>
	)
}

type IconName = React.ComponentProps<typeof Icon>['name']

function SettingsRow({
	to,
	href,
	download,
	icon,
	label,
	value,
	badge,
	children,
}: {
	to?: string
	href?: string
	download?: boolean
	icon: IconName
	label: string
	value?: string
	badge?: React.ReactNode
	children?: React.ReactNode
}) {
	const content = (
		<>
			<Icon name={icon} className="text-muted-foreground size-5 shrink-0" />
			<span className="min-w-0 flex-1">{label}</span>
			{value ? (
				<span className="text-muted-foreground max-w-[40%] truncate text-sm">
					{value}
				</span>
			) : null}
			{badge}
			{children}
			{(to || href) && !children ? (
				<Icon
					name={download ? 'download' : 'chevron-right'}
					className="text-muted-foreground size-4 shrink-0"
				/>
			) : null}
		</>
	)

	const className =
		'flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-accent/5 transition-colors'

	if (to) {
		return (
			<PushLink to={to} className={className}>
				{content}
			</PushLink>
		)
	}

	if (href) {
		return (
			<a href={href} download={download} className={className}>
				{content}
			</a>
		)
	}

	return <div className={className}>{content}</div>
}

async function signOutOfSessionsAction({ request, userId }: ProfileActionArgs) {
	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const sessionId = authSession.get(sessionKey)
	invariantResponse(
		sessionId,
		'You must be authenticated to sign out of other sessions',
	)
	await prisma.session.deleteMany({
		where: {
			userId,
			id: { not: sessionId },
		},
	})
	return { status: 'success' } as const
}

function SignOutOfSessions({
	loaderData,
}: {
	loaderData: Route.ComponentProps['loaderData']
}) {
	const [confirming, setConfirming] = useState(false)
	const fetcher = useFetcher<typeof signOutOfSessionsAction>()
	const otherSessionsCount = loaderData.user._count.sessions - 1
	const pending = fetcher.state !== 'idle'
	// Done: the sheet goes and the button shows the result.
	useEffect(() => {
		if (fetcher.state === 'idle' && fetcher.data) setConfirming(false)
	}, [fetcher.state, fetcher.data])

	return (
		<div>
			{otherSessionsCount ? (
				<fetcher.Form method="POST" id="sign-out-other-sessions">
					<StatusButton
						type="button"
						onClick={() => setConfirming(true)}
						variant="outline"
						status={pending ? 'pending' : (fetcher.data?.status ?? 'idle')}
						className="w-full"
						size="sm"
					>
						<Icon name="avatar">
							Log out of {otherSessionsCount} other sessions
						</Icon>
					</StatusButton>
					<ConfirmSheet
						open={confirming}
						onCancel={() => setConfirming(false)}
						title={`Log out of ${otherSessionsCount} other sessions?`}
						description="Those devices will need to log in again."
						confirmLabel="Log out"
						formId="sign-out-other-sessions"
						name="intent"
						value={signOutOfSessionsActionIntent}
						pending={pending}
					/>
				</fetcher.Form>
			) : (
				<p className="text-muted-foreground text-sm">
					<Icon name="avatar">This is your only session</Icon>
				</p>
			)}
		</div>
	)
}

async function deleteDataAction({ userId }: ProfileActionArgs) {
	await deleteAccount(userId)
	return redirectWithToast('/', {
		type: 'success',
		title: 'Account deleted',
		description: 'Your account has been deleted',
	})
}

function DeleteData({ outcome }: { outcome: AccountDeletionOutcome }) {
	const [confirming, setConfirming] = useState(false)
	const fetcher = useFetcher<typeof deleteDataAction>()
	const consequence =
		outcome.kind === 'household-stays'
			? `Your Recipes and Shopping stay with ${outcome.heirName}.`
			: `This deletes the Household and everything in it: Recipes, Menus, Plan, Staples and Shopping.`

	return (
		<div>
			<fetcher.Form method="POST" id="delete-account">
				<StatusButton
					type="button"
					onClick={() => setConfirming(true)}
					aria-describedby="delete-account-outcome"
					variant="destructive"
					status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
					className="w-full"
					size="sm"
				>
					<Icon name="trash">Delete my account</Icon>
				</StatusButton>
				<ConfirmSheet
					open={confirming}
					onCancel={() => setConfirming(false)}
					title="Delete your account?"
					description={consequence}
					confirmLabel="Delete account"
					formId="delete-account"
					name="intent"
					value={deleteDataActionIntent}
					pending={fetcher.state !== 'idle'}
				/>
			</fetcher.Form>
			<p
				id="delete-account-outcome"
				className="text-muted-foreground mt-2 text-sm"
			>
				{consequence}
			</p>
		</div>
	)
}
