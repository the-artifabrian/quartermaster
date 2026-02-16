import { useState } from 'react'
import { useFetcher } from 'react-router'
import { type EnrichedSubstitution } from '#app/utils/substitution-lookup.server.ts'
import { Icon } from './ui/icon.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx'

type SubstitutionHintProps = {
	ingredientName: string
	isProActive: boolean
	/** When provided, the LLM gets recipe context for better suggestions */
	recipeId?: string
	children: React.ReactNode
}

export function SubstitutionHint({
	ingredientName,
	isProActive,
	recipeId,
	children,
}: SubstitutionHintProps) {
	if (!isProActive) return <>{children}</>

	return (
		<SubstitutionPopover ingredientName={ingredientName} recipeId={recipeId}>
			{children}
		</SubstitutionPopover>
	)
}

function SubstitutionPopover({
	ingredientName,
	recipeId,
	children,
}: {
	ingredientName: string
	recipeId?: string
	children: React.ReactNode
}) {
	const [hasLoaded, setHasLoaded] = useState(false)
	const fetcher = useFetcher<{
		substitutions: EnrichedSubstitution[]
		source: string
	}>()

	const isLoading = fetcher.state !== 'idle'
	const substitutions = fetcher.data?.substitutions ?? []

	function handleOpen(open: boolean) {
		if (open && !hasLoaded) {
			setHasLoaded(true)
			const formData = new FormData()
			formData.set('ingredientName', ingredientName)
			if (recipeId) formData.set('recipeId', recipeId)
			void fetcher.submit(formData, {
				method: 'POST',
				action: '/resources/substitutions',
			})
		}
	}

	return (
		<span
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					e.stopPropagation()
				}
			}}
		>
			<Popover onOpenChange={handleOpen}>
				<PopoverTrigger asChild>
					<span
						role="button"
						tabIndex={0}
						className="inline-flex cursor-pointer items-center gap-0.5"
					>
						{children}
						<Icon
							name="shuffle"
							className="text-amber-500/70 hover:text-amber-600 size-3.5 shrink-0 transition-colors"
						/>
					</span>
				</PopoverTrigger>
				<PopoverContent
					className="w-72"
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div className="space-y-2">
						<p className="text-xs font-medium">
							Substitutes for{' '}
							<span className="text-foreground font-semibold">
								{ingredientName}
							</span>
						</p>

						{isLoading && !fetcher.data ? (
							<div className="space-y-2 py-1">
								<div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
								<div className="bg-muted h-3 w-full animate-pulse rounded" />
								<div className="bg-muted mt-3 h-4 w-2/3 animate-pulse rounded" />
								<div className="bg-muted h-3 w-5/6 animate-pulse rounded" />
							</div>
						) : substitutions.length > 0 ? (
							<ul className="space-y-2">
								{substitutions.map((sub, i) => (
									<li
										key={i}
										className="border-border/40 border-b pb-2 last:border-0 last:pb-0"
									>
										<div className="flex items-start gap-1.5">
											<span className="text-sm font-medium">
												{sub.replacement}
											</span>
											{sub.inInventory && (
												<span className="mt-0.5 shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
													You have this
												</span>
											)}
										</div>
										{sub.ratio && (
											<p className="text-muted-foreground text-xs">
												{sub.ratio}
											</p>
										)}
										{sub.context && (
											<p className="text-muted-foreground mt-0.5 text-xs">
												{sub.context}
											</p>
										)}
									</li>
								))}
							</ul>
						) : (
							<p className="text-muted-foreground py-2 text-center text-xs">
								No common substitutions found
							</p>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</span>
	)
}
