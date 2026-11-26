import { useRef, useSyncExternalStore } from 'react'
import { useFetcher, useRouteLoaderData, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useIsDemo } from '#app/components/demo.tsx'
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
import { DEMO_BLOCKED_MESSAGE } from '#app/utils/demo.ts'
import { ScaleMultiplierSchema } from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { formatRecipeForCopy } from '#app/utils/recipe-copy.ts'
import { type EnhanceableFields } from '#app/utils/recipe-enhance-llm.server.ts'
import { browserShareFunctions, shareOrCopy } from '#app/utils/share-link.ts'
import { PushLink } from './push-link.tsx'

type CopyableRecipe = Parameters<typeof formatRecipeForCopy>[0] & {
	id: string
	title: string
}

/**
 * A Recipe's actions draw twice: in its own row on a wide screen, and in the
 * nav bar on a phone, which the bar draws from the loader's data. Both read
 * the same state: the favourite through one keyed fetcher, the suggestion
 * through another, and whether there are cooking checks to reset through the
 * page (`useShareCookingReset`).
 */
function useRecipeFavorite(recipe: { id: string; isFavorite: boolean }) {
	const fetcher = useFetcher({ key: `recipe-favorite:${recipe.id}` })
	// While a tap is on its way, show the state it asked for.
	const isFavorite =
		fetcher.formData?.get('intent') === 'toggleFavorite'
			? fetcher.formData.get('isFavorite') === 'true'
			: recipe.isFavorite
	return { fetcher, isFavorite }
}

/** The suggestion's fetcher, keyed: the page opens its answer. */
export function useEnhanceFetcher() {
	return useFetcher<{
		error: string | null
		suggestions: EnhanceableFields | null
	}>({ key: 'enhance-recipe' })
}

function useRecipeActions(recipe: CopyableRecipe) {
	const enhanceFetcher = useEnhanceFetcher()
	const isDemo = useIsDemo()
	const rootData = useRouteLoaderData('root') as
		{ requestInfo?: { origin?: string } } | undefined
	const origin = rootData?.requestInfo?.origin
	const [searchParams] = useSearchParams()
	const scale = ScaleMultiplierSchema.safeParse(searchParams.get('scale'))
	const ratio = scale.success ? scale.data : 1

	// A second tap while the sheet is open makes Safari reject share() with
	// InvalidStateError, which would copy the link behind the sheet. Taps are
	// ignored until the first share settles.
	const shareInFlight = useRef(false)
	async function share() {
		// A demo's Recipes aren't shared (share.$recipeId.tsx).
		if (isDemo) {
			toast.error(DEMO_BLOCKED_MESSAGE)
			return
		}
		if (shareInFlight.current) return
		shareInFlight.current = true
		try {
			const url = `${origin ?? window.location.origin}/share/${recipe.id}`
			// share() is the first await, so it runs inside the tap's activation.
			const outcome = await shareOrCopy({
				data: { title: recipe.title, url },
				...browserShareFunctions(),
			})
			if (outcome === 'copied') {
				toast.success('Public link copied', {
					description: 'Anyone with this link can see the Recipe.',
				})
			} else if (outcome === 'copy-failed') {
				toast.error('Couldn’t copy the link. Try again.')
			}
		} finally {
			shareInFlight.current = false
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(formatRecipeForCopy(recipe, ratio))
			toast.success('Copied')
		} catch {
			toast.error('Couldn’t copy the Recipe')
		}
	}

	function enhance() {
		const formData = new FormData()
		formData.set('recipeId', recipe.id)
		void enhanceFetcher.submit(formData, {
			method: 'POST',
			action: '/resources/enhance-recipe',
		})
	}

	return { share, copy, enhance, enhancing: enhanceFetcher.state !== 'idle' }
}

// The page owns its cooking checks; it shares whether there are any, and how
// to reset them, with the bar's ⋯.
let cookingReset: { recipeId: string; reset: () => void } | null = null
const cookingResetListeners = new Set<() => void>()

/** Called by a Recipe's page with its reset while it has cooking checks. */
export function shareCookingReset(
	recipeId: string,
	reset: (() => void) | null,
) {
	if (reset) cookingReset = { recipeId, reset }
	else if (cookingReset?.recipeId === recipeId) cookingReset = null
	else return
	for (const listener of cookingResetListeners) listener()
}

function useCookingReset(recipeId: string) {
	const shared = useSyncExternalStore(
		(listener) => {
			cookingResetListeners.add(listener)
			return () => {
				cookingResetListeners.delete(listener)
			}
		},
		() => cookingReset,
		() => null,
	)
	return shared?.recipeId === recipeId ? shared.reset : undefined
}

function FavoriteButton({
	recipe,
	className,
	iconClassName,
}: {
	recipe: { id: string; isFavorite: boolean }
	className?: string
	iconClassName?: string
}) {
	const { fetcher, isFavorite } = useRecipeFavorite(recipe)
	const label = isFavorite ? 'Remove from favorites' : 'Add to favorites'
	return (
		// The bar draws outside the Recipe's route, so the form names it.
		<fetcher.Form method="POST" action={`/recipes/${recipe.id}`}>
			<input type="hidden" name="intent" value="toggleFavorite" />
			<input
				type="hidden"
				name="isFavorite"
				value={isFavorite ? 'false' : 'true'}
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="submit"
						variant="ghost"
						size="icon"
						aria-label={label}
						className={cn(
							className,
							isFavorite && 'text-primary hover:text-primary/80',
						)}
					>
						<Icon
							name={isFavorite ? 'heart-filled' : 'heart'}
							size="md"
							className={iconClassName}
						/>
					</Button>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
		</fetcher.Form>
	)
}

/**
 * Favourite, Share and ⋯ in the nav bar on a phone. Copy Recipe, which has
 * its own button in the wide row, is the ⋯'s first item there.
 */
export function RecipeNavActions({
	recipe,
	isProActive,
}: {
	recipe: CopyableRecipe & { isFavorite: boolean }
	isProActive: boolean
}) {
	const { share, copy, enhance, enhancing } = useRecipeActions(recipe)
	const reset = useCookingReset(recipe.id)
	const button =
		'text-foreground hover:bg-transparent transition-opacity active:opacity-60'
	const icon = 'size-[22px]'
	return (
		<>
			<FavoriteButton recipe={recipe} className={button} iconClassName={icon} />
			<Button
				variant="ghost"
				size="icon"
				aria-label="Share"
				className={button}
				onClick={share}
			>
				<Icon name="share" className={icon} />
			</Button>
			<RecipeMoreActions
				trigger={
					<Button
						variant="ghost"
						size="icon"
						aria-label="More actions"
						className={button}
					>
						<Icon name="dots-horizontal" className={icon} />
					</Button>
				}
				onResetCookingChecks={reset}
				onCopy={copy}
				isProActive={isProActive}
				onEnhance={enhance}
				enhancing={enhancing}
			/>
		</>
	)
}

function RecipeMoreActions({
	trigger,
	onResetCookingChecks,
	onCopy,
	isProActive,
	onEnhance,
	enhancing,
}: {
	trigger: React.ReactNode
	onResetCookingChecks?: () => void
	onCopy?: () => void
	isProActive: boolean
	onEnhance: () => void
	enhancing: boolean
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
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
				{onCopy && (
					<DropdownMenuItem onSelect={onCopy}>
						<Icon name="copy" size="sm" />
						Copy Recipe
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={() => window.print()}>
					<Icon name="file-text" size="sm" />
					Print
				</DropdownMenuItem>
				{isProActive && (
					<DropdownMenuItem onSelect={onEnhance} disabled={enhancing}>
						{enhancing ? (
							<Icon name="update" size="sm" className="animate-spin" />
						) : (
							<Icon name="sparkles" size="sm" />
						)}
						Suggest description & times
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/** A Recipe's row of actions on a wide screen. A phone has them in its nav
 * bar and under the facts. */
export function RecipeActionBar({
	recipe,
	isProActive,
	onAddToPlan,
	onResetCookingChecks,
}: {
	recipe: CopyableRecipe & { isFavorite: boolean }
	isProActive: boolean
	onAddToPlan: () => void
	onResetCookingChecks?: () => void
}) {
	const { share, copy, enhance, enhancing } = useRecipeActions(recipe)
	return (
		// The first glyph sits on the content edge; its 44px button hangs into
		// the gutter.
		<div className="mt-4 -ml-3 flex flex-wrap items-center gap-1 max-md:hidden md:mt-6 md:gap-2 print:hidden">
			<FavoriteButton recipe={recipe} />

			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Add to Plan"
						onClick={onAddToPlan}
					>
						<Icon name="calendar" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Add to Plan</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button asChild variant="ghost" size="icon" aria-label="Edit Recipe">
						<PushLink to={`/recipes/${recipe.id}/edit`}>
							<Icon name="pencil-1" size="md" />
						</PushLink>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Edit Recipe</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Copy Recipe"
						onClick={copy}
					>
						<Icon name="copy" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Copy Recipe</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Share"
						onClick={share}
					>
						<Icon name="share" size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Share</TooltipContent>
			</Tooltip>

			{/* Overflow: contextual reset, print, enhance */}
			<RecipeMoreActions
				trigger={
					<Button variant="ghost" size="icon" aria-label="More actions">
						<Icon name="dots-horizontal" size="md" />
					</Button>
				}
				onResetCookingChecks={onResetCookingChecks}
				isProActive={isProActive}
				onEnhance={enhance}
				enhancing={enhancing}
			/>
		</div>
	)
}
