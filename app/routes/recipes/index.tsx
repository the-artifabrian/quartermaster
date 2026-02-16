import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { addDays } from 'date-fns'
import { useMemo, useRef } from 'react'
import { Link, useFetcher, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { GettingStartedChecklist } from '#app/components/getting-started-checklist.tsx'
import {
	RecipeCard,
	RecipeCardGrid,
	RecipeListRow,
} from '#app/components/recipe-card.tsx'
import {
	IngredientHaveItButton,
	RecipeMatchCard,
	RecipeMatchCardGrid,
} from '#app/components/recipe-match-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { cn, useDebounce } from '#app/utils/misc.tsx'
import {
	buildInventoryLookup,
	getCanonicalIngredientName,
	ingredientMatchesAnyInventoryItem,
	matchRecipesWithInventory,
	type RecipeMatch,
} from '#app/utils/recipe-matching.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'My Recipes | Quartermaster' }]
}

const SORT_OPTIONS = [
	{ value: 'recent', label: 'Recently Updated' },
	{ value: 'most-cooked', label: 'Most Cooked' },
	{ value: 'recently-cooked', label: 'Recently Cooked' },
	{ value: 'alphabetical', label: 'Alphabetical' },
	{ value: 'newest', label: 'Newest First' },
] as const

type SortOption = (typeof SORT_OPTIONS)[number]['value']

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { isProActive } = await getUserTier(userId)
	const url = new URL(request.url)
	const search = url.searchParams.get('search') ?? ''
	const explicitSort = url.searchParams.get('sort')
	const sort = (explicitSort ?? 'recent') as SortOption
	const view = url.searchParams.get('view') ?? 'grid'

	const quality = url.searchParams.get('quality') ?? ''
	const favoritesOnly = url.searchParams.get('favorites') === 'true'
	const rawMaxTime = url.searchParams.get('maxTime')
	const maxTime = rawMaxTime
		? Number.isNaN(+rawMaxTime)
			? null
			: Math.min(1440, Math.max(0, +rawMaxTime))
		: null

	// Determine Prisma orderBy for simple sort options
	const orderBy = (() => {
		switch (sort) {
			case 'alphabetical':
				return { title: 'asc' as const }
			case 'newest':
				return { createdAt: 'desc' as const }
			default:
				return { updatedAt: 'desc' as const }
		}
	})()

	const [recipes, inventoryItems, mealPlanEntryCount, allRecipesForQuality] =
		await Promise.all([
			prisma.recipe.findMany({
				where: {
					householdId,
					...(favoritesOnly && { isFavorite: true }),
					...(search && {
						OR: [
							{ title: { contains: search } },
							{ description: { contains: search } },
							{ ingredients: { some: { name: { contains: search } } } },
						],
					}),
				},
				select: {
					id: true,
					title: true,
					description: true,
					prepTime: true,
					cookTime: true,
					isFavorite: true,
					servings: true,
					image: { select: { objectKey: true } },
					tags: { select: { id: true, name: true, category: true } },
					cookingLogs: {
						select: { cookedAt: true },
						orderBy: { cookedAt: 'desc' as const },
						take: 1,
					},
					_count: { select: { cookingLogs: true } },
					ingredients: {
						select: {
							id: true,
							name: true,
							amount: true,
							unit: true,
							notes: true,
							isHeading: true,
							order: true,
							recipeId: true,
						},
						orderBy: { order: 'asc' as const },
					},
				},
				orderBy,
			}),
			isProActive
				? prisma.inventoryItem.findMany({ where: { householdId } })
				: Promise.resolve([]),
			isProActive
				? prisma.mealPlanEntry.count({
						where: { mealPlan: { householdId } },
					})
				: Promise.resolve(0),
			prisma.recipe.findMany({
				where: { householdId },
				select: {
					id: true,
					title: true,
					_count: { select: { ingredients: true, instructions: true } },
				},
			}),
		])

	const hasInventory = inventoryItems.length > 0
	const useMatchSort = hasInventory && !explicitSort

	// Total recipe count comes from the unfiltered quality query
	const totalRecipeCount = allRecipesForQuality.length

	// Post-filter by total cook time (prepTime + cookTime).
	// Recipes with no time data (both null) are included since unknown ≠ slow.
	let filteredRecipes = maxTime
		? recipes.filter((r) => {
				const total = (r.prepTime ?? 0) + (r.cookTime ?? 0)
				if (total === 0) return true // no time data — don't exclude
				return total <= maxTime
			})
		: recipes

	// Handle sort options that need JS-level sorting
	if (sort === 'most-cooked') {
		filteredRecipes = [...filteredRecipes].sort(
			(a, b) => b._count.cookingLogs - a._count.cookingLogs,
		)
	} else if (sort === 'recently-cooked') {
		filteredRecipes = [...filteredRecipes].sort((a, b) => {
			const aDate = a.cookingLogs[0]?.cookedAt?.getTime() ?? 0
			const bDate = b.cookingLogs[0]?.cookedAt?.getTime() ?? 0
			return bDate - aDate
		})
	}

	// Compute quality flags for imported recipe review
	const flaggedIds = new Set<string>()
	const titleCounts = new Map<string, string[]>()
	for (const r of allRecipesForQuality) {
		if (r._count.ingredients === 0 || r._count.instructions === 0) {
			flaggedIds.add(r.id)
		}
		const lower = r.title.toLowerCase()
		const ids = titleCounts.get(lower) ?? []
		ids.push(r.id)
		titleCounts.set(lower, ids)
	}
	for (const ids of titleCounts.values()) {
		if (ids.length > 1) {
			for (const id of ids) flaggedIds.add(id)
		}
	}
	const flaggedCount = flaggedIds.size

	if (quality === 'flagged') {
		filteredRecipes = filteredRecipes.filter((r) => flaggedIds.has(r.id))
	}

	// Match data (when inventory exists)
	type MatchData = {
		matches: RecipeMatch[]
		inventoryItemCount: number
		makeableCount: number
		expiringMatches: Array<RecipeMatch & { expiringCount: number }>
		expiringItems: Array<{
			id: string
			name: string
			daysUntilExpiry: number
		}>
		nearMatches: RecipeMatch[]
		uniqueMissingNames: string[]
		cookingStats: Record<
			string,
			{ lastCookedAt: string | null; cookCount: number }
		>
	}

	let matchData: MatchData | null = null

	if (hasInventory) {
		const matches = matchRecipesWithInventory(
			filteredRecipes as Parameters<typeof matchRecipesWithInventory>[0],
			inventoryItems,
		)

		const makeableCount = matches.filter((m) => m.canMake).length

		// Find items expiring within 7 days
		const now = new Date()
		const sevenDaysFromNow = addDays(now, 7)
		const expiringItems = inventoryItems.filter(
			(item) =>
				item.expiresAt &&
				new Date(item.expiresAt) >= now &&
				new Date(item.expiresAt) <= sevenDaysFromNow,
		)

		// Find recipes that use expiring ingredients
		let expiringMatches: Array<RecipeMatch & { expiringCount: number }> = []
		if (expiringItems.length > 0) {
			const expiringLookup = buildInventoryLookup(expiringItems)
			expiringMatches = matches
				.map((match) => {
					const expiringCount = match.recipe.ingredients.filter(
						(ing) => ingredientMatchesAnyInventoryItem(ing, expiringLookup),
					).length
					return { ...match, expiringCount }
				})
				.filter((m) => m.expiringCount > 0)
				.sort((a, b) => b.expiringCount - a.expiringCount)
				.slice(0, 6)
		}

		// Near-matches: recipes missing 1-3 ingredients
		const nearMatches = matches.filter(
			(m) =>
				!m.canMake &&
				m.missingIngredients.length > 0 &&
				m.missingIngredients.length <= 3,
		)

		// Deduplicate missing ingredient names
		const uniqueMissingNames = (() => {
			const seen = new Set<string>()
			const names: string[] = []
			for (const m of nearMatches) {
				for (const i of m.missingIngredients) {
					const canonical = getCanonicalIngredientName(i.name)
					if (!seen.has(canonical)) {
						seen.add(canonical)
						names.push(i.name)
					}
				}
			}
			return names
		})()

		// Cooking stats for match cards
		const cookingStats: Record<
			string,
			{ lastCookedAt: string | null; cookCount: number }
		> = {}
		for (const recipe of filteredRecipes) {
			cookingStats[recipe.id] = {
				lastCookedAt:
					recipe.cookingLogs[0]?.cookedAt?.toISOString() ?? null,
				cookCount: recipe._count.cookingLogs,
			}
		}

		// Sort by match percentage when no explicit sort was chosen
		if (useMatchSort) {
			const matchById = new Map(matches.map((m) => [m.recipe.id, m]))
			filteredRecipes = [...filteredRecipes].sort((a, b) => {
				const aMatch = matchById.get(a.id)?.matchPercentage ?? 0
				const bMatch = matchById.get(b.id)?.matchPercentage ?? 0
				return bMatch - aMatch
			})
		}

		matchData = {
			matches,
			inventoryItemCount: inventoryItems.length,
			makeableCount,
			expiringMatches,
			expiringItems: expiringItems.map((item) => ({
				id: item.id,
				name: item.name,
				daysUntilExpiry: Math.max(
					0,
					Math.floor(
						(new Date(item.expiresAt!).getTime() - now.getTime()) /
							(1000 * 60 * 60 * 24),
					),
				),
			})),
			nearMatches,
			uniqueMissingNames,
			cookingStats,
		}
	}

	return {
		recipes: filteredRecipes,
		search,
		favoritesOnly,
		maxTime,
		sort,
		view,
		totalRecipeCount,
		flaggedCount,
		quality,
		hasInventory,
		isProActive,
		onboarding: {
			hasRecipes: totalRecipeCount > 0,
			hasInventory,
			hasMealPlan: mealPlanEntryCount > 0,
		},
		matchData,
	}
}

export default function RecipesIndex({ loaderData }: Route.ComponentProps) {
	const {
		recipes,
		search,
		favoritesOnly,
		maxTime,
		sort,
		view,
		totalRecipeCount,
		flaggedCount,
		quality,
		isProActive,
		onboarding,
		matchData,
	} = loaderData
	const [searchParams, setSearchParams] = useSearchParams()
	const fetcher = useFetcher<{
		status: string
		intent?: string
		addedCount: number
	}>()
	const prevFetcherState = useRef(fetcher.state)

	// Show toast when fetcher transitions from loading → idle with data
	if (
		prevFetcherState.current === 'loading' &&
		fetcher.state === 'idle' &&
		fetcher.data
	) {
		const { intent } = fetcher.data
		if (intent !== 'addToInventory') {
			if (fetcher.data.status === 'success') {
				const count = fetcher.data.addedCount
				if (count > 0) {
					toast.success(
						`Added ${count} item${count === 1 ? '' : 's'} to your shopping list`,
					)
				} else {
					toast.info('All items are already on your shopping list')
				}
			}
		}
	}
	prevFetcherState.current = fetcher.state

	// Build match lookup for rendering
	const matchLookup = useMemo(() => {
		if (!matchData) return null
		const map = new Map<string, RecipeMatch>()
		for (const m of matchData.matches) {
			map.set(m.recipe.id, m)
		}
		return map
	}, [matchData])

	const makeableOnly = searchParams.get('makeable') === 'true'

	const handleSearchChange = useDebounce((value: string) => {
		const params = new URLSearchParams(searchParams)
		if (value) {
			params.set('search', value)
		} else {
			params.delete('search')
		}
		setSearchParams(params, { replace: true })
	}, 300)

	const handleMaxTimeChange = (value: string) => {
		const params = new URLSearchParams(searchParams)
		if (value) {
			params.set('maxTime', value)
		} else {
			params.delete('maxTime')
		}
		setSearchParams(params, { replace: true })
	}

	const handleFavoritesToggle = () => {
		const params = new URLSearchParams(searchParams)
		if (favoritesOnly) {
			params.delete('favorites')
		} else {
			params.set('favorites', 'true')
		}
		setSearchParams(params, { replace: true })
	}

	const handleSortChange = (value: string) => {
		const params = new URLSearchParams(searchParams)
		if (value && value !== 'recent') {
			params.set('sort', value)
		} else {
			params.delete('sort')
		}
		setSearchParams(params, { replace: true })
	}

	const handleViewChange = (value: string) => {
		const params = new URLSearchParams(searchParams)
		if (value === 'list') {
			params.set('view', 'list')
		} else {
			params.delete('view')
		}
		setSearchParams(params, { replace: true })
	}

	const handleMakeableToggle = () => {
		const params = new URLSearchParams(searchParams)
		if (makeableOnly) {
			params.delete('makeable')
		} else {
			params.set('makeable', 'true')
		}
		setSearchParams(params, { replace: true })
	}

	const hasFilters = search || favoritesOnly || maxTime || quality

	const handleClearFilters = () => {
		// Preserve sort and view when clearing filters
		const params = new URLSearchParams()
		if (sort !== 'recent') params.set('sort', sort)
		if (view === 'list') params.set('view', 'list')
		if (makeableOnly) params.set('makeable', 'true')
		setSearchParams(params, { replace: true })
	}

	// Filter recipes to makeable-only when in match mode
	const displayRecipes =
		matchData && makeableOnly
			? recipes.filter((r) => matchLookup?.get(r.id)?.canMake)
			: recipes

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-linear-to-b">
				<div className="container flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
					<h1 className="text-2xl font-bold">
						My Recipes{' '}
						<span className="text-muted-foreground text-base font-normal">
							({totalRecipeCount})
						</span>
					</h1>
					<div className="flex gap-2">
						<Button asChild variant="outline">
							<Link to="/resources/surprise-me">
								<Icon name="shuffle" size="sm" />
								Surprise Me
							</Link>
						</Button>
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button>
									<Icon name="plus" size="sm" />
									New Recipe
									<Icon name="chevron-down" size="sm" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem asChild>
									<Link to="/recipes/new" className="gap-2">
										<Icon name="pencil-1" size="sm" />
										Full Recipe
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/recipes/quick" className="gap-2">
										<Icon name="file-text" size="sm" />
										Quick Entry
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/recipes/import" className="gap-2">
										<Icon name="link-2" size="sm" />
										Import from URL
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/recipes/bulk-import" className="gap-2">
										<Icon name="download" size="sm" />
										Bulk Import
									</Link>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>

			<div className="container py-4">
				{/* Search & Filters */}
				<div className="bg-card border-border/50 shadow-warm mb-4 space-y-3 rounded-2xl border p-3">
					{/* Search bar — full width row */}
					<div className="relative">
						<Icon
							name="magnifying-glass"
							className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
							size="sm"
						/>
						<Input
							type="search"
							placeholder="Search recipes..."
							defaultValue={search}
							onChange={(e) => handleSearchChange(e.target.value)}
							className="bg-background pl-10"
						/>
					</div>

					{/* Filter controls row */}
					<div className="flex flex-wrap items-center gap-2">
						<select
							value={sort}
							onChange={(e) => handleSortChange(e.target.value)}
							aria-label="Sort recipes"
							className="bg-card border-input min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
						>
							{SORT_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<select
							value={maxTime?.toString() ?? ''}
							onChange={(e) => handleMaxTimeChange(e.target.value)}
							aria-label="Filter by cook time"
							className="bg-card border-input min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
						>
							<option value="">Any time</option>
							<option value="30">Under 30 min</option>
							<option value="60">Under 1 hour</option>
							<option value="120">Under 2 hours</option>
						</select>
						<div className="flex items-center gap-1">
							<Button
								variant={favoritesOnly ? 'default' : 'outline'}
								size="icon"
								onClick={handleFavoritesToggle}
								aria-label={
									favoritesOnly ? 'Show all recipes' : 'Show favorites only'
								}
								aria-pressed={favoritesOnly}
								className={cn(!favoritesOnly && 'bg-background')}
							>
								<Icon
									name={favoritesOnly ? 'heart-filled' : 'heart'}
									size="sm"
								/>
							</Button>
							<button
								type="button"
								onClick={() => handleViewChange('grid')}
								className={cn(
									'min-h-11 min-w-11 rounded-md p-2 transition-colors',
									view !== 'list'
										? 'bg-accent text-accent-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								aria-label="Grid view"
								aria-pressed={view !== 'list'}
							>
								<Icon name="dashboard" size="sm" />
							</button>
							<button
								type="button"
								onClick={() => handleViewChange('list')}
								className={cn(
									'min-h-11 min-w-11 rounded-md p-2 transition-colors',
									view === 'list'
										? 'bg-accent text-accent-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								aria-label="List view"
								aria-pressed={view === 'list'}
							>
								<Icon name="rows" size="sm" />
							</button>
						</div>
					</div>

					{/* Match stats inline */}
					{matchData && (
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="text-muted-foreground flex gap-3 text-sm">
								<span>
									<span className="text-foreground font-semibold">
										{matchData.makeableCount}
									</span>{' '}
									makeable
								</span>
								<span>
									<span className="text-foreground font-semibold">
										{matchData.inventoryItemCount}
									</span>{' '}
									in inventory
								</span>
							</div>
							<Button
								variant={makeableOnly ? 'default' : 'ghost'}
								size="sm"
								className="h-7 text-xs"
								onClick={handleMakeableToggle}
							>
								<Icon
									name={makeableOnly ? 'check' : 'cookie'}
									size="sm"
								/>
								{makeableOnly ? 'Showing Makeable' : 'Only Makeable'}
							</Button>
						</div>
					)}

					{/* Active filter summary */}
					{hasFilters && (
						<div className="text-muted-foreground text-sm">
							{displayRecipes.length} of {totalRecipeCount}{' '}
							{totalRecipeCount === 1 ? 'recipe' : 'recipes'}
							<span className="mx-2">·</span>
							<button
								type="button"
								onClick={handleClearFilters}
								className="text-primary hover:text-primary/80 font-medium"
							>
								Clear filters
							</button>
						</div>
					)}
				</div>

				<GettingStartedChecklist onboarding={onboarding} isProActive={isProActive} />

				{flaggedCount > 0 && quality !== 'flagged' && (
					<div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
						<Icon
							name="question-mark-circled"
							className="size-5 flex-shrink-0 text-amber-500"
						/>
						<p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-200">
							<span className="font-semibold">
								{flaggedCount} recipe{flaggedCount === 1 ? '' : 's'}
							</span>{' '}
							may need a quick review — missing ingredients, instructions, or
							possible duplicates
						</p>
						<Button
							variant="outline"
							size="sm"
							className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
							onClick={() => {
								const params = new URLSearchParams(searchParams)
								params.set('quality', 'flagged')
								setSearchParams(params, { replace: true })
							}}
						>
							Review these
						</Button>
					</div>
				)}

				{quality === 'flagged' && (
					<div className="mb-4 flex items-center justify-between">
						<p className="text-sm font-medium">
							Showing {displayRecipes.length} recipe
							{displayRecipes.length === 1 ? '' : 's'} that may need review
						</p>
						<button
							type="button"
							onClick={() => {
								const params = new URLSearchParams(searchParams)
								params.delete('quality')
								setSearchParams(params, { replace: true })
							}}
							className="text-primary hover:text-primary/80 text-sm font-medium"
						>
							Clear filter
						</button>
					</div>
				)}

				{/* Match mode UI */}
				{matchData && (
					<MatchModeUI
						matchData={matchData}
						makeableOnly={makeableOnly}
						fetcher={fetcher}
					/>
				)}

				{/* Recipe Grid / List */}
				{displayRecipes.length > 0 ? (
					view === 'list' ? (
						<div className="space-y-2">
							{displayRecipes.map((recipe) => (
								<RecipeListRow
									key={recipe.id}
									id={recipe.id}
									title={recipe.title}
									description={recipe.description}
									imageObjectKey={recipe.image?.objectKey}
									prepTime={recipe.prepTime}
									cookTime={recipe.cookTime}
									tags={recipe.tags}
									isFavorite={recipe.isFavorite}
									lastCookedAt={
										recipe.cookingLogs[0]?.cookedAt?.toISOString() ?? null
									}
									cookCount={recipe._count.cookingLogs}
									matchPercentage={
										matchLookup?.get(recipe.id)?.matchPercentage
									}
								/>
							))}
						</div>
					) : (
						<RecipeCardGrid>
							{displayRecipes.map((recipe) => (
								<RecipeCard
									key={recipe.id}
									id={recipe.id}
									title={recipe.title}
									description={recipe.description}
									imageObjectKey={recipe.image?.objectKey}
									prepTime={recipe.prepTime}
									cookTime={recipe.cookTime}
									tags={recipe.tags}
									isFavorite={recipe.isFavorite}
									lastCookedAt={
										recipe.cookingLogs[0]?.cookedAt?.toISOString() ?? null
									}
									cookCount={recipe._count.cookingLogs}
									matchPercentage={
										matchLookup?.get(recipe.id)?.matchPercentage
									}
								/>
							))}
						</RecipeCardGrid>
					)
				) : matchData ? (
					<MatchEmptyState
						inventoryItemCount={matchData.inventoryItemCount}
						makeableOnly={makeableOnly}
						onShowAll={handleMakeableToggle}
					/>
				) : hasFilters ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon
								name="magnifying-glass"
								className="text-accent/50 size-10"
							/>
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
							Nothing matches those filters
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Try broadening your search or{' '}
							<button
								type="button"
								onClick={handleClearFilters}
								className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
							>
								clear all filters
							</button>
							.
						</p>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon name="cookie" className="text-accent/50 size-10" />
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
							Your cookbook is empty
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Every great collection starts with one recipe. Type it in by hand
							or import from a URL.
						</p>
						<div className="mt-6 flex gap-3">
							<Button asChild>
								<Link to="/recipes/new">
									<Icon name="plus" size="sm" />
									Add Recipe
								</Link>
							</Button>
							<Button asChild variant="outline">
								<Link to="/recipes/import">
									<Icon name="link-2" size="sm" />
									Import from URL
								</Link>
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

function MatchModeUI({
	matchData,
	makeableOnly,
	fetcher,
}: {
	matchData: NonNullable<Awaited<ReturnType<typeof loader>>['matchData']>
	makeableOnly: boolean
	fetcher: ReturnType<typeof useFetcher>
}) {
	const {
		expiringMatches,
		expiringItems,
		nearMatches,
		uniqueMissingNames,
		cookingStats,
	} = matchData

	return (
		<>
			{/* Expiring Items Section */}
			{expiringMatches.length > 0 && (
				<div className="border-accent/10 bg-accent/5 mb-4 rounded-2xl border p-4">
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<Icon name="clock" className="size-4 text-amber-500" />
						<h2 className="text-sm font-semibold">
							Use before you lose it
						</h2>
						<div className="flex flex-wrap gap-1.5">
							{expiringItems.map((item) => {
								const isUrgent = item.daysUntilExpiry <= 1
								return (
									<span
										key={item.id}
										className={cn(
											'rounded-full px-2 py-0.5 text-xs font-medium',
											isUrgent
												? 'animate-pulse bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
												: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
										)}
									>
										{item.name} (
										{item.daysUntilExpiry === 0
											? 'today'
											: item.daysUntilExpiry === 1
												? 'tomorrow'
												: `${item.daysUntilExpiry}d`}
										)
									</span>
								)
							})}
						</div>
					</div>
					<RecipeMatchCardGrid>
						{expiringMatches.map((match) => (
							<RecipeMatchCard
								key={match.recipe.id}
								match={match}
								lastCookedAt={cookingStats[match.recipe.id]?.lastCookedAt}
								cookCount={cookingStats[match.recipe.id]?.cookCount}
								urgentBorder
							/>
						))}
					</RecipeMatchCardGrid>
				</div>
			)}

			{/* Almost There — slim banner */}
			{nearMatches.length > 0 && !makeableOnly && (
				<div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
					<div className="flex items-center gap-2">
						<Icon
							name="star"
							className="size-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
						/>
						<span className="text-sm text-emerald-800 dark:text-emerald-200">
							<span className="font-semibold">
								{uniqueMissingNames.length}
							</span>{' '}
							ingredient{uniqueMissingNames.length !== 1 ? 's' : ''} from{' '}
							<span className="font-semibold">{nearMatches.length}</span>{' '}
							more recipe{nearMatches.length !== 1 ? 's' : ''}
						</span>
					</div>
					<div className="flex flex-wrap gap-1">
						{uniqueMissingNames.slice(0, 6).map((name) => (
							<span
								key={name}
								className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 py-0.5 pl-2 pr-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
							>
								{name}
								<IngredientHaveItButton name={name} variant="banner" />
							</span>
						))}
						{uniqueMissingNames.length > 6 && (
							<span className="text-xs leading-5 text-emerald-600 dark:text-emerald-400">
								+{uniqueMissingNames.length - 6}
							</span>
						)}
					</div>
					<fetcher.Form
						method="POST"
						action="/resources/discover-actions"
						className="ml-auto shrink-0"
					>
						<input type="hidden" name="intent" value="addMissing" />
						<input
							type="hidden"
							name="recipeIds"
							value={nearMatches.map((m) => m.recipe.id).join(',')}
						/>
						<Button
							type="submit"
							size="sm"
							variant="outline"
							className="h-7 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
							disabled={fetcher.state !== 'idle'}
						>
							<Icon name="plus" size="sm" />
							{fetcher.state !== 'idle' ? 'Adding...' : 'Add to list'}
						</Button>
					</fetcher.Form>
				</div>
			)}
		</>
	)
}

function MatchEmptyState({
	inventoryItemCount,
	makeableOnly,
	onShowAll,
}: {
	inventoryItemCount: number
	makeableOnly: boolean
	onShowAll: () => void
}) {
	if (inventoryItemCount === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center">
				<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
					<Icon name="file-text" className="text-accent/50 size-10" />
				</div>
				<h2 className="mt-4 font-serif text-xl font-semibold">
					What's in your kitchen?
				</h2>
				<p className="text-muted-foreground mt-2 max-w-sm">
					Tell us what's in your pantry, fridge, and freezer so we can match
					recipes to your ingredients.
				</p>
				<Button asChild className="mt-6">
					<Link to="/inventory">
						<Icon name="plus" size="sm" />
						Add to Inventory
					</Link>
				</Button>
			</div>
		)
	}

	return (
		<div className="flex flex-col items-center justify-center py-16 text-center">
			<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
				<Icon name="magnifying-glass" className="text-accent/50 size-10" />
			</div>
			<h2 className="mt-4 font-serif text-xl font-semibold">
				{makeableOnly
					? 'No perfect matches yet'
					: 'No recipes match your filter'}
			</h2>
			<p className="text-muted-foreground mt-2 max-w-sm">
				{makeableOnly
					? "None of your recipes match what's in your kitchen right now. Time to go shopping or add new recipes?"
					: 'Try adjusting your filters.'}
			</p>
			<div className="mt-6 flex gap-3">
				{makeableOnly && (
					<Button onClick={onShowAll}>Show All Recipes</Button>
				)}
				<Button variant="outline" asChild>
					<Link to="/inventory">
						<Icon name="plus" size="sm" />
						Add to Inventory
					</Link>
				</Button>
			</div>
		</div>
	)
}
