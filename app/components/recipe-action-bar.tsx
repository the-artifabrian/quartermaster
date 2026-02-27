import { type useFetcher, Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'

export function RecipeActionBar({
	recipeId,
	isFavorite,
	isProActive,
	favoriteFetcher,
	enhanceFetcher,
	onIMadeThis,
	onAddToPlan,
	onShare,
	onEnhance,
}: {
	recipeId: string
	isFavorite: boolean
	isProActive: boolean
	favoriteFetcher: ReturnType<typeof useFetcher>
	enhanceFetcher: ReturnType<typeof useFetcher>
	onIMadeThis: () => void
	onAddToPlan: () => void
	onShare: () => void
	onEnhance: () => void
}) {
	return (
		<div className="mt-4 flex items-center gap-1 md:mt-6 md:gap-2 print:hidden">
			{/* "I Made This" — text+icon on desktop, icon-only on mobile */}
			<Button onClick={onIMadeThis} className="gap-2 max-md:hidden">
				<Icon name="check" size="sm" />I Made This
			</Button>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						onClick={onIMadeThis}
						variant="ghost"
						size="icon"
						aria-label="I Made This"
						className="text-emerald-500 hover:text-emerald-600 md:hidden"
					>
						<Icon name="check" className="size-6" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>I Made This</TooltipContent>
			</Tooltip>

			{/* Favorite */}
			<favoriteFetcher.Form method="POST">
				<input type="hidden" name="intent" value="toggleFavorite" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="submit"
							variant="ghost"
							size="icon"
							aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
							className={isFavorite ? 'text-accent hover:text-accent/80' : ''}
						>
							<Icon name={isFavorite ? 'heart-filled' : 'heart'} size="md" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{isFavorite ? 'Remove from favorites' : 'Add to favorites'}
					</TooltipContent>
				</Tooltip>
			</favoriteFetcher.Form>

			{/* Add to Plan */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Add to meal plan"
						onClick={onAddToPlan}
					>
						<Icon name="calendar" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Add to meal plan</TooltipContent>
			</Tooltip>

			{/* Edit */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button asChild variant="ghost" size="icon" aria-label="Edit recipe">
						<Link to={`/recipes/${recipeId}/edit`}>
							<Icon name="pencil-1" size="md" />
						</Link>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Edit recipe</TooltipContent>
			</Tooltip>

			{/* Share */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Share recipe"
						onClick={onShare}
					>
						<Icon name="share" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Copy public link</TooltipContent>
			</Tooltip>

			{/* Print — desktop only */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Print recipe"
						onClick={() => window.print()}
						className="max-md:hidden"
					>
						<Icon name="file-text" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Print recipe</TooltipContent>
			</Tooltip>

			{/* Enhance */}
			{isProActive && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Enhance with AI"
							onClick={onEnhance}
							disabled={enhanceFetcher.state !== 'idle'}
							className="text-violet-500 hover:text-violet-600"
						>
							{enhanceFetcher.state !== 'idle' ? (
								<Icon name="update" className="size-5 animate-spin" />
							) : (
								<Icon name="sparkles" size="md" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Enhance with AI</TooltipContent>
				</Tooltip>
			)}
		</div>
	)
}
