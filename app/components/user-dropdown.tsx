import { Img } from 'openimg/react'
import { Link, useRouteLoaderData } from 'react-router'
import { type loader as rootLoader } from '#app/root.tsx'
import { cn, getUserImgSrc } from '#app/utils/misc.tsx'
import { useDaysUntilExpiry, useIsProActive } from '#app/utils/subscription.ts'
import { useUser } from '#app/utils/user.ts'

export function UserDropdown() {
	const user = useUser()
	const rootData = useRouteLoaderData<typeof rootLoader>('root')
	const householdName = rootData?.householdName
	const isPro = useIsProActive()
	const daysLeft = useDaysUntilExpiry()
	return (
		<Link
			to="/settings/profile"
			prefetch="intent"
			className="bg-card hover:bg-muted/50 border-border/50 shadow-warm flex items-center gap-2 rounded-full border p-1 transition-colors sm:pr-3"
			aria-label="Settings"
		>
			<Img
				className="ring-accent/20 size-8 rounded-full object-cover ring-2"
				alt={user.name ?? user.username}
				src={getUserImgSrc(user.image?.objectKey)}
				width={256}
				height={256}
				aria-hidden="true"
			/>
			<div className="hidden flex-col items-start sm:flex">
				<span className="text-body-sm font-bold">
					{user.name ?? user.username}
				</span>
				{householdName && householdName !== 'My Household' && (
					<span className="text-muted-foreground text-xs">{householdName}</span>
				)}
				{isPro && daysLeft !== null && daysLeft <= 14 ? (
					<span
						className={cn(
							'text-xs font-medium',
							daysLeft <= 3
								? 'text-destructive font-bold'
								: daysLeft <= 7
									? 'text-accent'
									: 'text-muted-foreground',
						)}
					>
						{daysLeft === 0 ? 'Pro expires today' : `Pro · ${daysLeft}d left`}
					</span>
				) : null}
			</div>
		</Link>
	)
}
