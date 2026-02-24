import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import { useUser } from '#app/utils/user.ts'

export function OnboardingNudge({
	nudgeId,
	icon,
	title,
	description,
	ctaText,
	ctaHref,
	dismissText = 'Dismiss',
	className,
}: {
	nudgeId: string
	icon: IconName
	title: string
	description: string
	ctaText?: string
	ctaHref?: string
	dismissText?: string
	className?: string
}) {
	const user = useUser()
	const storageKey = `onboarding-nudge-dismissed:${nudgeId}:${user.id}`
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		if (localStorage.getItem(storageKey) !== 'true') {
			setVisible(true)
		}
	}, [storageKey])

	if (!visible) return null

	function handleDismiss() {
		localStorage.setItem(storageKey, 'true')
		setVisible(false)
	}

	return (
		<div
			className={cn(
				'flex items-start gap-3 rounded-lg bg-accent/8 p-4',
				className,
			)}
		>
			<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
				<Icon name={icon} size="sm" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium">{title}</p>
				<p className="mt-0.5 text-sm text-muted-foreground">
					{description}
				</p>
				<div className="mt-2 flex items-center gap-3">
					{ctaText && ctaHref ? (
						<Link
							to={ctaHref}
							className="text-sm font-medium text-accent hover:text-accent/80"
						>
							{ctaText} &rarr;
						</Link>
					) : null}
					<button
						type="button"
						onClick={handleDismiss}
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						{dismissText}
					</button>
				</div>
			</div>
			<button
				type="button"
				onClick={handleDismiss}
				className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
				aria-label={`Dismiss ${title}`}
			>
				<Icon name="cross-1" size="sm" />
			</button>
		</div>
	)
}
