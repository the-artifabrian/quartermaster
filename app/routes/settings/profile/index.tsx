import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Img } from 'openimg/react'
import { Form, Link, useFetcher } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { ThemeSwitch } from '#app/routes/resources/theme-switch.tsx'
import { requireUserId, sessionKey } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getAvailableCodeCount } from '#app/utils/invite-codes.server.ts'
import { cn, getUserImgSrc, useDoubleCheck } from '#app/utils/misc.tsx'
import { useRequestInfo } from '#app/utils/request-info.ts'
import { authSessionStorage } from '#app/utils/session.server.ts'
import { getUserTier, type TierInfo } from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/index.ts'
import { twoFAVerificationType } from './two-factor/_layout.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
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
			image: {
				select: { objectKey: true },
			},
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

	const [password, tierInfo, availableInviteCodeCount] = await Promise.all([
		prisma.password.findUnique({
			select: { userId: true },
			where: { userId },
		}),
		getUserTier(userId),
		getAvailableCodeCount(userId),
	])

	return {
		user,
		hasPassword: Boolean(password),
		isTwoFactorEnabled: Boolean(twoFactorVerification),
		isProActive: tierInfo.isProActive,
		tierInfo,
		availableInviteCodeCount,
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
	const { user, tierInfo, isProActive, availableInviteCodeCount } = loaderData
	const requestInfo = useRequestInfo()
	const tierLabel = tierInfo.isProActive ? 'Pro' : 'Free'

	return (
		<div className="flex flex-col gap-6">
			{/* Profile Banner */}
			<Link
				to="edit"
				className="bg-card hover:bg-accent/5 flex items-center gap-4 rounded-xl border p-4 transition-colors"
			>
				<div className="relative size-16 shrink-0">
					<Img
						src={getUserImgSrc(user.image?.objectKey)}
						alt={user.name ?? user.username}
						className="ring-accent/20 h-full w-full rounded-full object-cover ring-2"
						width={256}
						height={256}
						isAboveFold
					/>
					<div className="bg-background/80 absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full">
						<Icon name="camera" className="size-3" />
					</div>
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium">
						{user.name ?? user.username}
					</p>
					<p className="text-muted-foreground truncate text-sm">
						{user.email}
					</p>
				</div>
				<Icon
					name="chevron-right"
					className="text-muted-foreground size-5 shrink-0"
				/>
			</Link>

			{/* General */}
			<SettingsSection label="General">
				<SettingsRow to="household" icon="home" label="Household" />
				<SettingsRow
					to="/upgrade"
					icon="sparkles"
					label="Subscription"
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
					icon={
						loaderData.isTwoFactorEnabled ? 'lock-closed' : 'lock-open-1'
					}
					label="Two-Factor Auth"
					value={loaderData.isTwoFactorEnabled ? 'On' : 'Off'}
				/>
			</SettingsSection>

			{/* Connections */}
			<SettingsSection label="Connections">
				<SettingsRow to="connections" icon="link-2" label="Connections" />
				<SettingsRow to="passkeys" icon="passkey" label="Passkeys" />
			</SettingsSection>

			{/* Invite Codes (Pro only) */}
			{isProActive ? (
				<SettingsSection label="Invite Codes">
					<SettingsRow
						to="invite-codes"
						icon="share"
						label="Invite Codes"
						badge={
							availableInviteCodeCount > 0 ? (
								<span className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-xs font-bold">
									{availableInviteCodeCount}
								</span>
							) : undefined
						}
					/>
				</SettingsSection>
			) : null}

			{/* Data */}
			<SettingsSection label="Data">
				<SettingsRow to="usage" icon="dashboard" label="Usage Stats" />
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
						className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/5"
					>
						<Icon
							name="exit"
							className="text-muted-foreground size-5 shrink-0"
						/>
						<span>Log Out</span>
					</button>
				</Form>
			</SettingsSection>

			{/* Danger Zone */}
			<SettingsSection>
				<div className="px-4 py-3">
					<SignOutOfSessions loaderData={loaderData} />
				</div>
				<div className="px-4 py-3">
					<DeleteData />
				</div>
			</SettingsSection>
		</div>
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
			<div className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
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
			<Link to={to} className={className}>
				{content}
			</Link>
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
	const dc = useDoubleCheck()
	const fetcher = useFetcher<typeof signOutOfSessionsAction>()
	const otherSessionsCount = loaderData.user._count.sessions - 1

	return (
		<div>
			{otherSessionsCount ? (
				<fetcher.Form method="POST">
					<StatusButton
						{...dc.getButtonProps({
							type: 'submit',
							name: 'intent',
							value: signOutOfSessionsActionIntent,
						})}
						variant={dc.doubleCheck ? 'destructive' : 'default'}
						status={
							fetcher.state !== 'idle'
								? 'pending'
								: (fetcher.data?.status ?? 'idle')
						}
						className="w-full"
						size="sm"
					>
						<Icon name="avatar">
							{dc.doubleCheck
								? `Are you sure?`
								: `Sign out of ${otherSessionsCount} other sessions`}
						</Icon>
					</StatusButton>
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
	await prisma.user.delete({ where: { id: userId } })
	return redirectWithToast('/', {
		type: 'success',
		title: 'Data Deleted',
		description: 'All of your data has been deleted',
	})
}

function DeleteData() {
	const dc = useDoubleCheck()
	const fetcher = useFetcher<typeof deleteDataAction>()

	return (
		<div>
			<fetcher.Form method="POST">
				<StatusButton
					{...dc.getButtonProps({
						type: 'submit',
						name: 'intent',
						value: deleteDataActionIntent,
					})}
					variant={dc.doubleCheck ? 'destructive' : 'default'}
					status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
					className="w-full"
					size="sm"
				>
					<Icon name="trash">
						{dc.doubleCheck ? `Are you sure?` : `Delete all your data`}
					</Icon>
				</StatusButton>
			</fetcher.Form>
		</div>
	)
}
