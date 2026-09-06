import { type useFetcher, Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
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
	onAddToPlan,
	onCopy,
	onShare,
	onEnhance,
	onResetCookingChecks,
}: {
	recipeId: string
	isFavorite: boolean
	isProActive: boolean
	favoriteFetcher: ReturnType<typeof useFetcher>
	enhanceFetcher: ReturnType<typeof useFetcher>
	onAddToPlan: () => void
	onCopy: () => void
	onShare: () => void
	onEnhance: () => void
	onResetCookingChecks?: () => void
}) {
	return (
		<div className="mt-4 flex flex-wrap items-center gap-1 md:mt-6 md:gap-2 print:hidden">
			{/* Favorite */}
			<favoriteFetcher.Form method="POST">
				<input type="hidden" name="intent" value="toggleFavorite" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="submit"
							variant="ghost"
							size="icon"
							aria-label={
								isFavorite ? 'Remove from favorites' : 'Add to favorites'
							}
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

			{/* Copy */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Copy Recipe"
						onClick={onCopy}
					>
						<Icon name="copy" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Copy recipe</TooltipContent>
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

			{/* Overflow: contextual reset, print, enhance */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label="More actions">
						<Icon name="dots-horizontal" size="md" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{onResetCookingChecks && (
						<DropdownMenuItem
							className="min-h-11"
							onSelect={onResetCookingChecks}
						>
							<Icon name="reset" size="sm" />
							Reset cooking checks
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onSelect={() => window.print()}>
						<Icon name="file-text" size="sm" />
						Print recipe
					</DropdownMenuItem>
					{isProActive && (
						<DropdownMenuItem
							onSelect={onEnhance}
							disabled={enhanceFetcher.state !== 'idle'}
						>
							{enhanceFetcher.state !== 'idle' ? (
								<Icon name="update" size="sm" className="animate-spin" />
							) : (
								<Icon name="sparkles" size="sm" />
							)}
							Suggest description & times
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
