import { useEffect, useState } from 'react'
import { useFetcher, useRouteLoaderData } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { type loader as rootLoader } from '#app/root.tsx'
import { useUser } from '#app/utils/user.ts'

export function InviteCodeBanner() {
	const user = useUser()
	const rootData = useRouteLoaderData<typeof rootLoader>('root')
	const fetcher = useFetcher()
	const storageKey = `invite-code-banner:${user.id}`
	const [visible, setVisible] = useState(false)
	const [code, setCode] = useState('')

	const isTrialing = rootData?.tierInfo.isTrialing ?? false
	const hasRedeemedCode = rootData?.hasRedeemedCode ?? false

	useEffect(() => {
		if (
			isTrialing &&
			!hasRedeemedCode &&
			localStorage.getItem(storageKey) !== 'true'
		) {
			setVisible(true)
		} else {
			setVisible(false)
		}
	}, [isTrialing, hasRedeemedCode, storageKey])

	if (!visible) return null

	function handleDismiss() {
		localStorage.setItem(storageKey, 'true')
		setVisible(false)
	}

	const fetcherError =
		fetcher.data && typeof fetcher.data === 'object' && 'error' in fetcher.data
			? (fetcher.data as { error: string | null; result?: unknown }).error ??
				'Invalid code format'
			: null

	return (
		<div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/8 p-4">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
				<Icon name="star" size="sm" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium">Have an invite code?</p>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Enter your code to unlock extended Pro access.
				</p>
				<fetcher.Form
					method="POST"
					action="/resources/redeem-invite-code"
					className="mt-2 flex items-center gap-2"
				>
					<input
						type="text"
						name="code"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="QM-XXXXXX"
						className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm uppercase placeholder:normal-case"
					/>
					<button
						type="submit"
						disabled={fetcher.state !== 'idle'}
						className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
					>
						{fetcher.state !== 'idle' ? 'Redeeming…' : 'Redeem'}
					</button>
				</fetcher.Form>
				{fetcherError ? (
					<p className="mt-1 text-sm text-destructive">{fetcherError}</p>
				) : null}
			</div>
			<button
				type="button"
				onClick={handleDismiss}
				className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
				aria-label="Dismiss invite code banner"
			>
				<Icon name="cross-1" size="sm" />
			</button>
		</div>
	)
}
