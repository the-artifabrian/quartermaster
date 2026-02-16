import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, useFetcher } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { type Route } from './+types/subscriptions.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

type UserRow = {
	id: string
	username: string
	name: string | null
	email: string
	householdName: string | null
	tier: string
	isTrialing: boolean
	trialExpired: boolean
	trialEndsAt: string | null
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithRole(request, 'admin')

	const users = await prisma.user.findMany({
		select: {
			id: true,
			username: true,
			name: true,
			email: true,
			subscription: {
				select: {
					tier: true,
					trialEndsAt: true,
					subscriptionExpiresAt: true,
				},
			},
			householdMembers: {
				select: {
					household: { select: { name: true } },
				},
			},
		},
		orderBy: { createdAt: 'asc' },
	})

	const now = new Date()

	const rows: UserRow[] = users.map((user) => {
		const sub = user.subscription
		const tier = sub?.tier ?? 'free'
		const isTrialing =
			sub?.trialEndsAt !== null &&
			sub?.trialEndsAt !== undefined &&
			sub.trialEndsAt > now
		const trialExpired =
			sub?.trialEndsAt !== null &&
			sub?.trialEndsAt !== undefined &&
			sub.trialEndsAt <= now

		return {
			id: user.id,
			username: user.username,
			name: user.name,
			email: user.email,
			householdName: user.householdMembers[0]?.household.name ?? null,
			tier,
			isTrialing,
			trialExpired,
			trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
		}
	})

	return { users: rows }
}

export async function action({ request }: Route.ActionArgs) {
	await requireUserWithRole(request, 'admin')

	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'changeTier') {
		const userId = formData.get('userId')
		const tier = formData.get('tier')

		if (typeof userId !== 'string' || typeof tier !== 'string') {
			return data({ error: 'Invalid form data' }, { status: 400 })
		}

		if (!['free', 'pro', 'household'].includes(tier)) {
			return data({ error: 'Invalid tier' }, { status: 400 })
		}

		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { id: true },
		})
		if (!user) {
			return data({ error: 'User not found' }, { status: 404 })
		}

		await prisma.subscription.upsert({
			where: { userId },
			update: { tier, trialEndsAt: null, subscriptionExpiresAt: null },
			create: { userId, tier },
		})

		return { success: true }
	}

	return data({ error: 'Unknown intent' }, { status: 400 })
}

const tierStyles: Record<string, string> = {
	pro: 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/30 dark:text-green-400',
	household:
		'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
	free: 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
}

function TierBadge({ tier }: { tier: string }) {
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tierStyles[tier] ?? tierStyles.free}`}
		>
			{tier}
		</span>
	)
}

function UserRow({ user }: { user: UserRow }) {
	const fetcher = useFetcher<typeof action>()
	const optimisticTier = fetcher.formData?.get('tier')?.toString() ?? user.tier

	return (
		<li className="flex items-center justify-between rounded-lg border p-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="font-medium">{user.username}</span>
					{user.name ? (
						<span className="text-muted-foreground text-sm">({user.name})</span>
					) : null}
					<TierBadge tier={optimisticTier} />
					{user.isTrialing && user.trialEndsAt ? (
						<span className="text-xs text-amber-600 dark:text-amber-400">
							Trial ends {new Date(user.trialEndsAt).toLocaleDateString()}
						</span>
					) : user.trialExpired ? (
						<span className="text-muted-foreground text-xs">Trial expired</span>
					) : null}
				</div>
				<p className="text-muted-foreground text-sm">
					{user.email}
					{user.householdName ? <span> · {user.householdName}</span> : null}
				</p>
			</div>
			<fetcher.Form method="POST" className="flex shrink-0 items-center gap-2">
				<input type="hidden" name="intent" value="changeTier" />
				<input type="hidden" name="userId" value={user.id} />
				<select
					name="tier"
					defaultValue={user.tier}
					className="border-input bg-background h-9 rounded-md border px-3 text-sm"
				>
					<option value="free">free</option>
					<option value="pro">pro</option>
					<option value="household">household</option>
				</select>
				<StatusButton
					type="submit"
					size="sm"
					status={
						fetcher.state === 'submitting'
							? 'pending'
							: fetcher.data && 'success' in fetcher.data
								? 'success'
								: 'idle'
					}
				>
					Save
				</StatusButton>
			</fetcher.Form>
		</li>
	)
}

export default function SubscriptionsAdminRoute({
	loaderData,
}: Route.ComponentProps) {
	return (
		<div className="container p-4">
			<h1 className="text-h2">Subscription Management</h1>
			<Spacer size="2xs" />
			<p className="text-muted-foreground text-sm">
				{loaderData.users.length} user
				{loaderData.users.length === 1 ? '' : 's'}
			</p>
			<Spacer size="2xs" />
			<ul className="flex flex-col gap-3">
				{loaderData.users.map((user) => (
					<UserRow key={user.id} user={user} />
				))}
			</ul>
		</div>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				403: ({ error }) => (
					<p>You are not allowed to do that: {error?.data.message}</p>
				),
			}}
		/>
	)
}
