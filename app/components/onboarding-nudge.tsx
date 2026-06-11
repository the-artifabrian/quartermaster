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
		<div className={cn('flex items-start gap-2 print:hidden', className)}>
			<Icon name={icon} size="sm" className="text-accent mt-0.5 shrink-0" />
			<p className="text-muted-foreground min-w-0 flex-1 text-sm">
				<span className="text-foreground font-medium">{title}.</span>{' '}
				{description}
				{ctaText && ctaHref ? (
					<>
						{' '}
						<Link
							to={ctaHref}
							className="text-accent hover:text-accent/80 font-medium whitespace-nowrap"
						>
							{ctaText} &rarr;
						</Link>
					</>
				) : null}
			</p>
			<button
				type="button"
				onClick={handleDismiss}
				className="text-muted-foreground hover:text-foreground shrink-0 text-sm font-medium"
			>
				{dismissText}
			</button>
		</div>
	)
}
