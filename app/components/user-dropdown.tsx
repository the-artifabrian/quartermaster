import { Img } from 'openimg/react'
import { useRef } from 'react'
import { Link, Form, useRouteLoaderData } from 'react-router'
import { type loader as rootLoader } from '#app/root.tsx'
import { cn, getUserImgSrc } from '#app/utils/misc.tsx'
import {
	useAvailableInviteCodeCount,
	useDaysUntilExpiry,
	useIsProActive,
	useWasProPreviously,
} from '#app/utils/subscription.ts'
import { useUser } from '#app/utils/user.ts'
import { Button } from './ui/button'
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuPortal,
	DropdownMenuContent,
	DropdownMenuItem,
} from './ui/dropdown-menu'
import { Icon } from './ui/icon'

export function UserDropdown() {
	const user = useUser()
	const rootData = useRouteLoaderData<typeof rootLoader>('root')
	const householdName = rootData?.householdName
	const isPro = useIsProActive()
	const daysLeft = useDaysUntilExpiry()
	const wasProPreviously = useWasProPreviously()
	const availableCodes = useAvailableInviteCodeCount()
	const formRef = useRef<HTMLFormElement>(null)
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button asChild variant="ghost">
					<Link
						to="/settings/profile"
						// this is for progressive enhancement
						onClick={(e) => e.preventDefault()}
						className="bg-card hover:bg-muted/50 border-border/50 shadow-warm flex items-center gap-2 rounded-full border"
						aria-label="User menu"
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
								<span className="text-muted-foreground text-xs">
									{householdName}
								</span>
							)}
							{isPro && daysLeft !== null && daysLeft <= 14 ? (
								<span
									className={cn(
										'text-xs font-medium',
										daysLeft <= 3
											? 'text-destructive font-bold'
											: daysLeft <= 7
												? 'text-amber-600 dark:text-amber-400'
												: 'text-muted-foreground',
									)}
								>
									{daysLeft === 0
										? 'Pro expires today'
										: `Pro · ${daysLeft}d left`}
								</span>
							) : null}
						</div>
					</Link>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuContent sideOffset={8} align="end">
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/settings/profile">
							<Icon className="text-body-md" name="avatar">
								Profile
							</Icon>
						</Link>
					</DropdownMenuItem>
					{isPro && availableCodes > 0 ? (
						<DropdownMenuItem asChild>
							<Link prefetch="intent" to="/settings/profile/invite-codes">
								<Icon className="text-body-md" name="share">
									Invite codes
								</Icon>
								<span className="bg-primary text-primary-foreground ml-auto inline-flex size-5 items-center justify-center rounded-full text-xs font-bold">
									{availableCodes}
								</span>
							</Link>
						</DropdownMenuItem>
					) : null}
					{isPro && daysLeft !== null && daysLeft <= 14 ? (
						<DropdownMenuItem asChild>
							<Link prefetch="intent" to="/upgrade">
								<Icon className="text-body-md" name="clock">
									{daysLeft === 0
										? 'Pro expires today'
										: `Pro: ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
								</Icon>
							</Link>
						</DropdownMenuItem>
					) : !isPro && wasProPreviously ? (
						<DropdownMenuItem asChild>
							<Link prefetch="intent" to="/upgrade">
								<Icon className="text-body-md" name="lock-open-1">
									Renew Pro access
								</Icon>
							</Link>
						</DropdownMenuItem>
					) : null}
					<Form action="/logout" method="POST" ref={formRef}>
						<DropdownMenuItem asChild>
							<button type="submit" className="w-full">
								<Icon className="text-body-md" name="exit">
									Logout
								</Icon>
							</button>
						</DropdownMenuItem>
					</Form>
				</DropdownMenuContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	)
}
