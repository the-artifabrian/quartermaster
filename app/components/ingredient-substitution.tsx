import { useState } from 'react'
import { useFetcher } from 'react-router'
import { stripDescriptors } from '#app/utils/ingredient-substitutions.ts'
import { type EnrichedSubstitution } from '#app/utils/substitution-lookup.server.ts'
import { Icon } from './ui/icon.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx'

type SubstitutionHintProps = {
	ingredientName: string
	isProActive: boolean
	/** When provided, the LLM gets recipe context for better suggestions */
	recipeId?: string
	/** When provided, substitution items become clickable and apply the replacement */
	onApply?: (replacement: string) => void
	children: React.ReactNode
}

export function SubstitutionHint({
	ingredientName,
	isProActive,
	recipeId,
	onApply,
	children,
}: SubstitutionHintProps) {
	if (!isProActive) return <>{children}</>

	return (
		<SubstitutionPopover
			ingredientName={ingredientName}
			recipeId={recipeId}
			onApply={onApply}
		>
			{children}
		</SubstitutionPopover>
	)
}

function SubstitutionPopover({
	ingredientName,
	recipeId,
	onApply,
	children,
}: {
	ingredientName: string
	recipeId?: string
	onApply?: (replacement: string) => void
	children: React.ReactNode
}) {
	const [hasLoaded, setHasLoaded] = useState(false)
	const [open, setOpen] = useState(false)
	const fetcher = useFetcher<{
		substitutions: EnrichedSubstitution[]
		source: string
	}>()

	const isLoading = fetcher.state !== 'idle'
	const substitutions = fetcher.data?.substitutions ?? []
	const source = fetcher.data?.source
	const isAISuggestion = source === 'llm' || source === 'cached'
	const displayName = stripDescriptors(ingredientName)

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen)
		if (nextOpen && !hasLoaded) {
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

	function handleApply(replacement: string) {
		if (onApply) {
			onApply(replacement)
			setOpen(false)
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
			<Popover open={open} onOpenChange={handleOpenChange}>
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
						<div className="flex items-center gap-1.5">
							<p className="text-xs font-medium">
								Substitutes for{' '}
								<span className="text-foreground font-semibold">
									{displayName}
								</span>
							</p>
							{isAISuggestion && (
								<span className="shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
									AI suggestion
								</span>
							)}
						</div>

						{isLoading && !fetcher.data ? (
							<div className="space-y-2 py-1">
								<div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
								<div className="bg-muted h-3 w-full animate-pulse rounded" />
								<div className="bg-muted mt-3 h-4 w-2/3 animate-pulse rounded" />
								<div className="bg-muted h-3 w-5/6 animate-pulse rounded" />
							</div>
						) : substitutions.length > 0 ? (
							<>
								<ul className="space-y-2">
									{substitutions.map((sub, i) => (
										<SubstitutionItem
											key={i}
											sub={sub}
											onApply={onApply ? handleApply : undefined}
										/>
									))}
								</ul>
								<p className="text-muted-foreground/70 border-border/30 border-t pt-2 text-[10px] leading-tight">
									Check for allergies. Substitutions may change
									flavor or texture.
								</p>
							</>
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

function SubstitutionItem({
	sub,
	onApply,
}: {
	sub: EnrichedSubstitution
	onApply?: (replacement: string) => void
}) {
	const isClickable = !!onApply

	return (
		<li
			className={`border-border/40 border-b pb-2 last:border-0 last:pb-0 ${
				isClickable
					? 'hover:bg-accent/10 -mx-1 cursor-pointer rounded-md px-1 py-1 transition-colors'
					: ''
			}`}
			role={isClickable ? 'button' : undefined}
			tabIndex={isClickable ? 0 : undefined}
			onClick={isClickable ? () => onApply(sub.replacement) : undefined}
			onKeyDown={
				isClickable
					? (e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								onApply(sub.replacement)
							}
						}
					: undefined
			}
		>
			<div className="flex items-start gap-1.5">
				<span className="text-sm font-medium">{sub.replacement}</span>
				{sub.inInventory && (
					<span className="mt-0.5 shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
						You have this
					</span>
				)}
				{isClickable && (
					<span className="text-muted-foreground mt-0.5 ml-auto shrink-0 text-[10px]">
						Use this
					</span>
				)}
			</div>
			{sub.ratio && (
				<p className="text-muted-foreground text-xs">{sub.ratio}</p>
			)}
			{sub.context && (
				<p className="text-muted-foreground mt-0.5 text-xs">{sub.context}</p>
			)}
		</li>
	)
}
