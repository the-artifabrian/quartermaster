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
	onShare,
	onEnhance,
}: {
	recipeId: string
	isFavorite: boolean
	isProActive: boolean
	favoriteFetcher: ReturnType<typeof useFetcher>
	enhanceFetcher: ReturnType<typeof useFetcher>
	onIMadeThis: () => void
	onShare: () => void
	onEnhance: () => void
}) {
	function renderFavoriteButton(withTooltip: boolean) {
		const button = (
			<Button
				type="submit"
				variant="ghost"
				size="icon"
				aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
				className={isFavorite ? 'text-red-500 hover:text-red-600' : ''}
			>
				<Icon name={isFavorite ? 'heart-filled' : 'heart'} size="md" />
			</Button>
		)

		if (!withTooltip) return button

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>
					{isFavorite ? 'Remove from favorites' : 'Add to favorites'}
				</TooltipContent>
			</Tooltip>
		)
	}

	function renderEditButton(withTooltip: boolean) {
		const button = (
			<Button asChild variant="ghost" size="icon" aria-label="Edit recipe">
				<Link to={`/recipes/${recipeId}/edit`}>
					<Icon name="pencil-1" size="md" />
				</Link>
			</Button>
		)

		if (!withTooltip) return button

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>Edit recipe</TooltipContent>
			</Tooltip>
		)
	}

	function renderPrintButton(withTooltip: boolean) {
		const button = (
			<Button
				variant="ghost"
				size="icon"
				aria-label="Print recipe"
				onClick={() => window.print()}
			>
				<Icon name="file-text" size="md" />
			</Button>
		)

		if (!withTooltip) return button

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>Print recipe</TooltipContent>
			</Tooltip>
		)
	}

	function renderShareButton(withTooltip: boolean) {
		const button = (
			<Button
				variant="ghost"
				size="icon"
				aria-label="Share recipe"
				onClick={onShare}
			>
				<Icon name="share" size="md" />
			</Button>
		)

		if (!withTooltip) return button

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>Copy public link</TooltipContent>
			</Tooltip>
		)
	}

	function renderEnhanceButton(withTooltip: boolean) {
		if (!isProActive) return null

		const button = (
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
		)

		if (!withTooltip) return button

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>Enhance with AI</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<>
			{/* Desktop: inline bar with Tooltips */}
			<div className="mt-6 hidden items-center gap-2 md:flex print:hidden">
				<Button
					onClick={onIMadeThis}
					className="gap-2 bg-green-600 hover:bg-green-700"
				>
					<Icon name="check" size="sm" />I Made This
				</Button>
				<favoriteFetcher.Form method="POST">
					<input type="hidden" name="intent" value="toggleFavorite" />
					{renderFavoriteButton(true)}
				</favoriteFetcher.Form>
				{renderEditButton(true)}
				{renderPrintButton(true)}
				{renderShareButton(true)}
				{renderEnhanceButton(true)}
			</div>

			{/* Mobile: fixed floating card, no Tooltips */}
			<div className="fixed inset-x-4 bottom-18 z-30 md:hidden print:hidden">
				<div className="bg-card/95 shadow-warm-lg flex items-center gap-1.5 rounded-2xl border p-2.5 backdrop-blur-md">
					<Button
						onClick={onIMadeThis}
						className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
					>
						<Icon name="check" size="sm" />I Made This
					</Button>
					<favoriteFetcher.Form method="POST">
						<input type="hidden" name="intent" value="toggleFavorite" />
						{renderFavoriteButton(false)}
					</favoriteFetcher.Form>
					{renderEditButton(false)}
					{renderPrintButton(false)}
					{renderShareButton(false)}
					{renderEnhanceButton(false)}
				</div>
			</div>
		</>
	)
}
