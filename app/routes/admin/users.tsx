import { useState } from 'react'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, redirect } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getRelativeTime } from '#app/utils/relative-time.ts'
import { type Route } from './+types/users.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
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

type UserRow = {
	id: string
	username: string
	name: string | null
	email: string
	householdName: string | null
	tier: string
	source: string
	joined: string
	lastActive: string | null
	lastCooked: string | null
	recipeCount: number
	inventoryCount: number
	cookLogCount: number
	codesRedeemed: number
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireAdmin(request)

	const users = await prisma.user.findMany({
		select: {
			id: true,
			username: true,
			name: true,
			email: true,
			createdAt: true,
			subscription: {
				select: {
					tier: true,
					trialEndsAt: true,
					subscriptionExpiresAt: true,
					stripeCustomerId: true,
				},
			},
			householdMembers: {
				select: {
					household: { select: { name: true } },
				},
			},
			sessions: {
				select: { updatedAt: true },
				orderBy: { updatedAt: 'desc' },
				take: 1,
			},
			cookingLogs: {
				select: { cookedAt: true },
				orderBy: { cookedAt: 'desc' },
				take: 1,
			},
			_count: {
				select: { recipes: true, inventoryItems: true, cookingLogs: true },
			},
			inviteCodesCreated: {
				select: { id: true },
				where: { redeemedById: { not: null } },
			},
		},
		orderBy: { createdAt: 'asc' },
	})

	const rows: UserRow[] = users.map((user) => {
		const sub = user.subscription
		const tier = sub?.tier ?? 'free'

		let source = '—'
		if (sub?.stripeCustomerId) {
			source = 'stripe'
		} else if (sub?.trialEndsAt) {
			source = 'invite'
		} else if (tier !== 'free') {
			source = 'admin'
		}

		return {
			id: user.id,
			username: user.username,
			name: user.name,
			email: user.email,
			householdName: user.householdMembers[0]?.household.name ?? null,
			tier,
			source,
			joined: user.createdAt.toISOString(),
			lastActive: user.sessions[0]?.updatedAt.toISOString() ?? null,
			lastCooked: user.cookingLogs[0]?.cookedAt.toISOString() ?? null,
			recipeCount: user._count.recipes,
			inventoryCount: user._count.inventoryItems,
			cookLogCount: user._count.cookingLogs,
			codesRedeemed: user.inviteCodesCreated.length,
		}
	})

	return { users: rows }
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
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tierStyles[tier] ?? tierStyles.free}`}
		>
			{tier}
		</span>
	)
}

type SortKey = keyof UserRow
type SortDir = 'asc' | 'desc'

const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
	{ key: 'username', label: 'Username' },
	{ key: 'tier', label: 'Tier' },
	{ key: 'source', label: 'Source' },
	{ key: 'householdName', label: 'Household' },
	{ key: 'joined', label: 'Joined' },
	{ key: 'lastActive', label: 'Last Active' },
	{ key: 'lastCooked', label: 'Last Cooked' },
	{ key: 'recipeCount', label: 'Recipes', numeric: true },
	{ key: 'inventoryCount', label: 'Inventory', numeric: true },
	{ key: 'cookLogCount', label: 'Cooks', numeric: true },
	{ key: 'codesRedeemed', label: 'Codes Redeemed', numeric: true },
]

function compareRows(a: UserRow, b: UserRow, key: SortKey, dir: SortDir) {
	const aVal = a[key]
	const bVal = b[key]

	// nulls always sort last
	if (aVal == null && bVal == null) return 0
	if (aVal == null) return 1
	if (bVal == null) return -1

	let cmp: number
	if (typeof aVal === 'number' && typeof bVal === 'number') {
		cmp = aVal - bVal
	} else {
		cmp = String(aVal).localeCompare(String(bVal))
	}

	return dir === 'asc' ? cmp : -cmp
}

function RelativeDate({ iso }: { iso: string | null }) {
	if (!iso) return <span className="text-muted-foreground">—</span>
	return (
		<time
			dateTime={iso}
			title={new Date(iso).toLocaleString()}
			suppressHydrationWarning
		>
			{getRelativeTime(new Date(iso))}
		</time>
	)
}

export default function UsersAdminRoute({ loaderData }: Route.ComponentProps) {
	const [sortKey, setSortKey] = useState<SortKey>('lastActive')
	const [sortDir, setSortDir] = useState<SortDir>('desc')

	function handleSort(key: SortKey) {
		if (key === sortKey) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
		} else {
			setSortKey(key)
			setSortDir('desc')
		}
	}

	const sorted = [...loaderData.users].sort((a, b) =>
		compareRows(a, b, sortKey, sortDir),
	)

	return (
		<div className="container p-4">
			<div className="text-muted-foreground flex gap-3 text-sm">
				<span className="font-medium text-foreground">Users</span>
				<Link to="/admin/subscriptions" className="underline-offset-4 hover:underline">
					Subscriptions
				</Link>
				<Link to="/admin/cache" className="underline-offset-4 hover:underline">
					Cache
				</Link>
			</div>
			<h1 className="text-h2 mt-2">User Analytics</h1>
			<p className="text-muted-foreground mt-1 text-sm">
				{loaderData.users.length} user
				{loaderData.users.length === 1 ? '' : 's'}
			</p>

			<div className="mt-4 overflow-x-auto rounded-xl border">
				<table className="w-full text-sm">
					<thead>
						<tr className="bg-muted/50 sticky top-0 border-b">
							{columns.map((col) => (
								<th
									key={col.key}
									className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium hover:bg-muted ${col.numeric ? 'text-right' : ''}`}
									onClick={() => handleSort(col.key)}
								>
									{col.label}
									{sortKey === col.key ? (
										<span className="ml-1">
											{sortDir === 'asc' ? '↑' : '↓'}
										</span>
									) : null}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sorted.map((user) => (
							<tr key={user.id} className="hover:bg-muted/30 border-b last:border-b-0">
								<td className="px-3 py-2">
									<div className="font-medium">{user.username}</div>
									<div className="text-muted-foreground text-xs">
										{user.email}
										{user.name ? ` · ${user.name}` : null}
									</div>
								</td>
								<td className="px-3 py-2">
									<TierBadge tier={user.tier} />
								</td>
								<td className="text-muted-foreground px-3 py-2">
									{user.source}
								</td>
								<td className="px-3 py-2">
									{user.householdName ?? (
										<span className="text-muted-foreground">—</span>
									)}
								</td>
								<td className="whitespace-nowrap px-3 py-2">
									<RelativeDate iso={user.joined} />
								</td>
								<td className="whitespace-nowrap px-3 py-2">
									<RelativeDate iso={user.lastActive} />
								</td>
								<td className="whitespace-nowrap px-3 py-2">
									<RelativeDate iso={user.lastCooked} />
								</td>
								<td
									className={`tabular-nums px-3 py-2 text-right ${user.recipeCount === 0 ? 'text-muted-foreground' : ''}`}
								>
									{user.recipeCount}
								</td>
								<td
									className={`tabular-nums px-3 py-2 text-right ${user.inventoryCount === 0 ? 'text-muted-foreground' : ''}`}
								>
									{user.inventoryCount}
								</td>
								<td
									className={`tabular-nums px-3 py-2 text-right ${user.cookLogCount === 0 ? 'text-muted-foreground' : ''}`}
								>
									{user.cookLogCount}
								</td>
								<td
									className={`tabular-nums px-3 py-2 text-right ${user.codesRedeemed === 0 ? 'text-muted-foreground' : ''}`}
								>
									{user.codesRedeemed}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
