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
 * nav bar on a phone, which the bar draws from the loader's data. Both show
 * the same state through keyed fetchers. What the bar sends goes through the
 * page (`shareRecipePage`): a fetcher answers an error at the route it was
 * made in, and the bar's is the root's, where a Recipe deleted meanwhile would
 * replace the whole app with the error.
 */
export function favoriteFetcherKey(recipeId: string) {
	return `recipe-favorite:${recipeId}`
}

function useRecipeFavorite(recipe: { id: string; isFavorite: boolean }) {
	const fetcher = useFetcher({ key: favoriteFetcherKey(recipe.id) })
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

/** What a Recipe's page does for the bar's buttons. */
export type RecipePageActions = {
	toggleFavorite: (favorite: boolean) => void
	enhance: () => void
	/** While the page has cooking checks. */
	reset?: () => void
}

let recipePage: { recipeId: string; actions: RecipePageActions } | null = null
const recipePageListeners = new Set<() => void>()

/** Called by a Recipe's page while it is on screen, null as it leaves. */
export function shareRecipePage(
	recipeId: string,
	actions: RecipePageActions | null,
) {
	if (actions) recipePage = { recipeId, actions }
	else if (recipePage?.recipeId === recipeId) recipePage = null
	else return
	for (const listener of recipePageListeners) listener()
}

function useRecipePage(recipeId: string) {
	const shared = useSyncExternalStore(
		(listener) => {
			recipePageListeners.add(listener)
			return () => {
				recipePageListeners.delete(listener)
			}
		},
		() => recipePage,
		() => null,
	)
	return shared?.recipeId === recipeId ? shared.actions : undefined
}

function FavoriteButton({
	recipe,
}: {
	recipe: { id: string; isFavorite: boolean }
}) {
	const { fetcher, isFavorite } = useRecipeFavorite(recipe)
	const label = isFavorite ? 'Remove from favorites' : 'Add to favorites'
	return (
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
						className={cn(isFavorite && 'text-primary hover:text-primary/80')}
					>
						<Icon name={isFavorite ? 'heart-filled' : 'heart'} size="md" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
		</fetcher.Form>
	)
}

/**
 * Favourite, Share and ⋯ in the nav bar on a phone. Edit Recipe and Copy
 * Recipe, which have their own buttons in the wide row, are in the ⋯ there,
 * Edit first.
 */
export function RecipeNavActions({
	recipe,
	isProActive,
}: {
	recipe: CopyableRecipe & { isFavorite: boolean }
	isProActive: boolean
}) {
	const { share, copy, enhancing } = useRecipeActions(recipe)
	const { isFavorite } = useRecipeFavorite(recipe)
	const page = useRecipePage(recipe.id)
	const button =
		'text-foreground hover:bg-transparent transition-opacity active:opacity-60'
	const icon = 'size-[22px]'
	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
				className={cn(button, isFavorite && 'text-primary')}
				onClick={() => page?.toggleFavorite(!isFavorite)}
			>
				<Icon name={isFavorite ? 'heart-filled' : 'heart'} className={icon} />
			</Button>
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
				editTo={`/recipes/${recipe.id}/edit`}
				onResetCookingChecks={page?.reset}
				onCopy={copy}
				isProActive={isProActive}
				onEnhance={() => page?.enhance()}
				enhancing={enhancing}
			/>
		</>
	)
}

function RecipeMoreActions({
	trigger,
	editTo,
	onResetCookingChecks,
	onCopy,
	isProActive,
	onEnhance,
	enhancing,
}: {
	trigger: React.ReactNode
	/** The edit screen, for a menu on a screen with no Edit button. */
	editTo?: string
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
				{editTo && (
					<DropdownMenuItem asChild>
						<PushLink to={editTo} aria-label="Edit Recipe">
							<Icon name="pencil-1" size="sm" />
							Edit
						</PushLink>
					</DropdownMenuItem>
				)}
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
