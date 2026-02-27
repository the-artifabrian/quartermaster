import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useRef, useState } from 'react'
import { redirect } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { getCodeStatus } from '#app/utils/invite-code-status.ts'
import {
	getAvailableCodeCount,
	getUserInviteCodes,
} from '#app/utils/invite-codes.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/invite-codes.ts'
import { type SettingsPageHandle } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const tierInfo = await getUserTier(userId)

	if (!tierInfo.isProActive) {
		throw redirect('/upgrade')
	}

	const [codes, availableCount] = await Promise.all([
		getUserInviteCodes(userId),
		getAvailableCodeCount(userId),
	])

	return {
		codes: codes.map((c) => ({
			...c,
			expiresAt: c.expiresAt?.toISOString() ?? null,
			redeemedAt: c.redeemedAt?.toISOString() ?? null,
			createdAt: c.createdAt.toISOString(),
			redeemedByUsername: c.redeemedBy?.username ?? null,
		})),
		availableCount,
	}
}

export default function InviteCodesPage({ loaderData }: Route.ComponentProps) {
	const { codes, availableCount } = loaderData

	return (
		<div className="flex flex-col gap-8">
			<p className="text-muted-foreground text-sm">
			</p>

			<div className="bg-card shadow-warm rounded-xl border p-4">
				<h3 className="text-muted-foreground mb-3 px-4 text-xs font-semibold tracking-wider uppercase">
					Your Codes
					{availableCount > 0 ? (
						<span className="bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5 text-xs font-medium normal-case tracking-normal">
							{availableCount} available
						</span>
					) : null}
				</h3>
				{codes.length === 0 ? (
					<p className="text-muted-foreground px-4 py-2 text-sm">
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{codes.map((code) => {
							const status = getCodeStatus(code)
							return (
								<li
									key={code.id}
									className="flex items-center justify-between rounded-lg px-4 py-2"
								>
									<div className="flex items-center gap-3">
										<code className="whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-sm">
											{code.code}
										</code>
										<span
											className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}
										>
											{status.label}
										</span>
										{code.redeemedByUsername ? (
											<span className="text-muted-foreground text-xs">
												redeemed by {code.redeemedByUsername}
											</span>
										) : null}
									</div>
									{!code.redeemedAt &&
									(!code.expiresAt || new Date(code.expiresAt) > new Date()) ? (
										<ShareButton code={code.code} />
									) : null}
								</li>
							)
						})}
					</ul>
				)}
			</div>
		</div>
	)
}

function ShareButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false)
	const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

	async function handleShare() {
		const shareData = {
		}
		if (navigator.share && navigator.canShare(shareData)) {
			await navigator.share(shareData)
		} else {
			await navigator.clipboard.writeText(code)
			setCopied(true)
			if (timerRef.current) clearTimeout(timerRef.current)
			timerRef.current = setTimeout(() => setCopied(false), 2000)
		}
	}

	return (
		<Button variant="ghost" size="sm" onClick={handleShare} type="button">
			{copied ? (
				<Icon name="check" size="sm" className="text-primary" />
			) : (
				<Icon name="share" size="sm" />
			)}
		</Button>
	)
}
