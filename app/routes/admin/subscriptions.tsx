import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link, redirect, useFetcher } from 'react-router'
import { Spacer } from '#app/components/spacer.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getCodeStatus } from '#app/utils/invite-code-status.ts'
import { createAdminCodes } from '#app/utils/invite-codes.server.ts'
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

type InviteCodeRow = {
	id: string
	code: string
	grantsDays: number
	expiresAt: string | null
	redeemedAt: string | null
	redeemedByUsername: string | null
	createdAt: string
}

async function requireAdmin(request: Request) {
	const userId = await requireUserId(request)
	const user = await prisma.user.findFirst({
		select: { id: true },
		where: { id: userId, roles: { some: { name: 'admin' } } },
	})
	if (!user) throw redirect('/')
	return user.id
}

export async function loader({ request }: Route.LoaderArgs) {
	const adminId = await requireAdmin(request)

	const [users, inviteCodes] = await Promise.all([
		prisma.user.findMany({
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
		}),
		prisma.inviteCode.findMany({
			where: { type: 'admin' },
			select: {
				id: true,
				code: true,
				grantsDays: true,
				expiresAt: true,
				redeemedAt: true,
				createdAt: true,
				redeemedBy: { select: { username: true } },
			},
			orderBy: { createdAt: 'desc' },
		}),
	])

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

	const codeRows: InviteCodeRow[] = inviteCodes.map((c) => ({
		id: c.id,
		code: c.code,
		grantsDays: c.grantsDays,
		expiresAt: c.expiresAt?.toISOString() ?? null,
		redeemedAt: c.redeemedAt?.toISOString() ?? null,
		redeemedByUsername: c.redeemedBy?.username ?? null,
		createdAt: c.createdAt.toISOString(),
	}))

	return { users: rows, inviteCodes: codeRows, adminId }
}

export async function action({ request }: Route.ActionArgs) {
	const adminId = await requireAdmin(request)

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

	if (intent === 'generateCodes') {
		const countStr = formData.get('count')
		const grantsDaysStr = formData.get('grantsDays')

		const count = Math.min(Math.max(Number(countStr) || 1, 1), 50)
		const grantsDays = Number(grantsDaysStr) || 60

		await createAdminCodes(adminId, count, { grantsDays })
		return { success: true }
	}

	if (intent === 'deleteCode') {
		const codeId = formData.get('codeId')
		if (typeof codeId !== 'string') {
			return data({ error: 'Invalid code ID' }, { status: 400 })
		}
		await prisma.inviteCode.delete({ where: { id: codeId } })
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

function InviteCodeRow({ code }: { code: InviteCodeRow }) {
	const fetcher = useFetcher<typeof action>()
	const status = getCodeStatus(code)
	const isDeleting = fetcher.state !== 'idle'

	return (
		<li
			className={`flex items-center justify-between rounded-lg border p-3 ${isDeleting ? 'opacity-50' : ''}`}
		>
			<div className="flex items-center gap-3">
				<code className="rounded bg-gray-100 px-2 py-1 font-mono text-sm dark:bg-gray-800">
					{code.code}
				</code>
				<span
					className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}
				>
					{status.label}
				</span>
				{code.redeemedByUsername ? (
					<span className="text-muted-foreground text-xs">
						by {code.redeemedByUsername}
					</span>
				) : null}
				<span className="text-muted-foreground text-xs">
					{code.grantsDays}d
				</span>
			</div>
			<div className="flex items-center gap-2">
				{!code.redeemedAt ? (
					<>
						<CopyButton text={code.code} />
						<fetcher.Form method="POST">
							<input type="hidden" name="intent" value="deleteCode" />
							<input type="hidden" name="codeId" value={code.id} />
							<Button variant="ghost" size="sm" type="submit">
								<Icon name="trash" size="sm" />
							</Button>
						</fetcher.Form>
					</>
				) : null}
			</div>
		</li>
	)
}

function CopyButton({ text }: { text: string }) {
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => navigator.clipboard.writeText(text)}
			type="button"
		>
			<Icon name="link-2" size="sm" />
		</Button>
	)
}

export default function SubscriptionsAdminRoute({
	loaderData,
}: Route.ComponentProps) {
	const generateFetcher = useFetcher<typeof action>()

	return (
		<div className="container p-4">
			<div className="text-muted-foreground flex gap-3 text-sm">
				<Link to="/admin/users" className="underline-offset-4 hover:underline">
					Users
				</Link>
				<span className="text-foreground font-medium">Subscriptions</span>
				<Link to="/admin/cache" className="underline-offset-4 hover:underline">
					Cache
				</Link>
			</div>
			<h1 className="text-h2 mt-2">Subscription Management</h1>

			{/* Invite Code Generation */}
			<Spacer size="2xs" />
			<div className="rounded-xl border p-4">
				<h2 className="text-lg font-semibold">Invite Codes</h2>
				<generateFetcher.Form
					method="POST"
					className="mt-3 flex items-end gap-3"
				>
					<input type="hidden" name="intent" value="generateCodes" />
					<div>
						<label
							htmlFor="count"
							className="text-muted-foreground mb-1 block text-xs"
						>
							Count (1-50)
						</label>
						<input
							id="count"
							name="count"
							type="number"
							min={1}
							max={50}
							defaultValue={5}
							className="border-input bg-background h-9 w-20 rounded-md border px-3 text-sm"
						/>
					</div>
					<div>
						<label
							htmlFor="grantsDays"
							className="text-muted-foreground mb-1 block text-xs"
						>
							Pro days
						</label>
						<input
							id="grantsDays"
							name="grantsDays"
							type="number"
							min={1}
							defaultValue={60}
							className="border-input bg-background h-9 w-20 rounded-md border px-3 text-sm"
						/>
					</div>
					<StatusButton
						type="submit"
						status={generateFetcher.state === 'submitting' ? 'pending' : 'idle'}
					>
						Generate
					</StatusButton>
				</generateFetcher.Form>

				{loaderData.inviteCodes.length > 0 ? (
					<ul className="mt-4 flex flex-col gap-2">
						{loaderData.inviteCodes.map((code) => (
							<InviteCodeRow key={code.id} code={code} />
						))}
					</ul>
				) : (
					<p className="text-muted-foreground mt-4 text-sm">
						No admin codes generated yet.
					</p>
				)}
			</div>

			{/* User List */}
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
