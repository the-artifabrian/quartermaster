import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { GettingStartedChecklist } from '#app/components/getting-started-checklist.tsx'
import { InviteCodeBanner } from '#app/components/invite-code-banner.tsx'
import { RecipeCard, RecipeCardGrid } from '#app/components/recipe-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { cn, useDebounce } from '#app/utils/misc.tsx'
import {
	matchRecipesWithInventory,
	type RecipeMatch,
} from '#app/utils/recipe-matching.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
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

	// Query inventory first to decide whether ingredient data is needed
	const [inventoryItems, mealPlanEntryCount, totalRecipeCount] =
		await Promise.all([
			prisma.inventoryItem.findMany({ where: { householdId } }),
			isProActive
				? prisma.mealPlanEntry.count({
						where: { mealPlan: { householdId } },
					})
				: Promise.resolve(0),
			prisma.recipe.count({ where: { householdId } }),
		])

	const hasInventory = inventoryItems.length > 0
	const useMatchSort = hasInventory && !explicitSort

	const recipes = await prisma.recipe.findMany({
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
			isAiGenerated: true,
			servings: true,
			image: { select: { objectKey: true } },
			cookingLogs: {
				select: { cookedAt: true },
				orderBy: { cookedAt: 'desc' as const },
				take: 1,
			},
			_count: {
				select: {
					cookingLogs: true,
					instructions: true,
					...(hasInventory ? {} : { ingredients: true }),
				},
			},
			...(hasInventory && {
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
			}),
		},
		orderBy,
	})

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

	// Quality flags computed from main query data (no extra query needed)
	if (quality === 'flagged') {
		const titleCounts = new Map<string, string[]>()
		for (const r of filteredRecipes) {
			const lower = r.title.toLowerCase()
			const ids = titleCounts.get(lower) ?? []
			ids.push(r.id)
			titleCounts.set(lower, ids)
		}
		const duplicateIds = new Set<string>()
		for (const ids of titleCounts.values()) {
			if (ids.length > 1) {
				for (const id of ids) duplicateIds.add(id)
			}
		}
		filteredRecipes = filteredRecipes.filter(
			(r) =>
				(hasInventory
					? r.ingredients.length === 0
					: r._count.ingredients === 0) ||
				r._count.instructions === 0 ||
				duplicateIds.has(r.id),
		)
	}

	// Match data (when inventory exists)
	type MatchData = {
		matches: RecipeMatch[]
		inventoryItemCount: number
		makeableCount: number
	}

	let matchData: MatchData | null = null

	if (hasInventory) {
		const matches = matchRecipesWithInventory(
			filteredRecipes as Parameters<typeof matchRecipesWithInventory>[0],
			inventoryItems,
		)

		const makeableCount = matches.filter((m) => m.canMake).length

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
		}
	}

	return {
		recipes: filteredRecipes,
		search,
		favoritesOnly,
		maxTime,
		sort,
		totalRecipeCount,
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
		totalRecipeCount,
		isProActive,
		onboarding,
		matchData,
	} = loaderData
	const [searchParams, setSearchParams] = useSearchParams()

	// Save/restore scroll position for tab-style navigation
	useEffect(() => {
		const SCROLL_KEY = 'scroll:/recipes'
		const saved = sessionStorage.getItem(SCROLL_KEY)
		if (saved) {
			requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)))
		}

		let ticking = false
		const onScroll = () => {
			if (!ticking) {
				requestAnimationFrame(() => {
					sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
					ticking = false
				})
				ticking = true
			}
		}
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => window.removeEventListener('scroll', onScroll)
	}, [])

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
	const [filtersOpen, setFiltersOpen] = useState(false)
	const activeFilterCount =
		(favoritesOnly ? 1 : 0) +
		(maxTime ? 1 : 0) +
		(sort !== 'recent' ? 1 : 0) +
		(makeableOnly ? 1 : 0)

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

	const handleMakeableToggle = () => {
		const params = new URLSearchParams(searchParams)
		if (makeableOnly) {
			params.delete('makeable')
		} else {
			params.set('makeable', 'true')
		}
		setSearchParams(params, { replace: true })
	}

	const hasFilters = search || favoritesOnly || maxTime

	const handleClearFilters = () => {
		// Preserve sort when clearing filters
		const params = new URLSearchParams()
		if (sort !== 'recent') params.set('sort', sort)
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
			<div className="border-border/50 border-b">
				<div className="container-grid flex items-center justify-between gap-3 py-3 md:py-4">
					<h1 className="font-serif text-2xl font-normal">
						My Recipes{' '}
						<span className="text-muted-foreground text-base font-normal">
							({totalRecipeCount})
						</span>
					</h1>
					<div className="flex gap-2">
						{isProActive && loaderData.hasInventory && (
							<Button
								asChild
								variant="secondary"
								className="hidden md:inline-flex"
							>
								<Link to="/recipes/generate">
									<Icon name="sparkles" size="sm" />
									Generate Recipe
								</Link>
							</Button>
						)}
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button className="size-10 rounded-full p-0 sm:h-auto sm:w-auto sm:rounded-lg sm:px-4 sm:py-2">
									<Icon name="plus" size="sm" />
									<span className="hidden sm:inline">New Recipe</span>
									<Icon
										name="chevron-down"
										size="sm"
										className="hidden sm:inline"
									/>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{isProActive && loaderData.hasInventory && (
									<DropdownMenuItem asChild className="md:hidden">
										<Link to="/recipes/generate">
											<Icon name="sparkles" size="sm" />
											Generate Recipe
										</Link>
									</DropdownMenuItem>
								)}
								<DropdownMenuItem asChild>
									<Link to="/recipes/new">
										<Icon name="pencil-1" size="sm" />
										Full Recipe
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/recipes/quick">
										<Icon name="file-text" size="sm" />
										Quick Entry
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild>
									<Link to="/recipes/import">
										<Icon name="link-2" size="sm" />
										Import
									</Link>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>

			<div className="container-grid py-4">
				{/* Search & Filters */}
				<div className="mb-3 space-y-1.5">
					{/* Search bar + mobile filter toggle */}
					<div className="flex items-center gap-1.5">
						<div className="relative flex-1">
							<Icon
								name="magnifying-glass"
								className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
								size="sm"
							/>
							<input
								type="search"
								placeholder="Search recipes..."
								defaultValue={search}
								onChange={(e) => handleSearchChange(e.target.value)}
								className="border-border/50 bg-secondary/50 placeholder:text-muted-foreground focus:border-primary/30 focus:ring-primary/20 h-10 w-full rounded-full border pr-4 pl-10 text-sm transition-colors outline-none focus:ring-1"
							/>
						</div>
						<button
							type="button"
							onClick={() => setFiltersOpen((o) => !o)}
							aria-expanded={filtersOpen}
							aria-label="Toggle filters"
							className={cn(
								'relative flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors md:hidden',
								filtersOpen
									? 'border-primary/30 bg-primary/10 text-primary'
									: 'border-border/50 bg-secondary/50 text-muted-foreground',
							)}
						>
							<Icon name="mixer-horizontal" size="sm" />
							{activeFilterCount > 0 && (
								<span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[10px] font-bold">
									{activeFilterCount}
								</span>
							)}
						</button>
					</div>

					{/* Filter controls — collapsible on mobile, always visible on desktop */}
					<div
						className={cn(
							'flex-wrap items-center gap-1.5 md:flex',
							filtersOpen ? 'flex' : 'hidden',
						)}
					>
						<select
							value={sort}
							onChange={(e) => handleSortChange(e.target.value)}
							aria-label="Sort recipes"
							className="border-border/50 bg-secondary/50 text-muted-foreground h-8 min-w-0 rounded-full border px-2.5 text-xs"
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
							className="border-border/50 bg-secondary/50 text-muted-foreground h-8 min-w-0 rounded-full border px-2.5 text-xs"
						>
							<option value="">Any time</option>
							<option value="30">Under 30 min</option>
							<option value="60">Under 1 hour</option>
							<option value="120">Under 2 hours</option>
						</select>
						<button
							type="button"
							onClick={handleFavoritesToggle}
							aria-label={
								favoritesOnly ? 'Show all recipes' : 'Show favorites only'
							}
							aria-pressed={favoritesOnly}
							className={cn(
								'flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors',
								favoritesOnly
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border/50 bg-secondary/50 text-muted-foreground hover:bg-secondary',
							)}
						>
							<Icon name={favoritesOnly ? 'heart-filled' : 'heart'} size="xs" />
							Favorites
						</button>
						{matchData && (
							<button
								type="button"
								onClick={handleMakeableToggle}
								aria-label={
									makeableOnly
										? 'Show all recipes'
										: 'Show only recipes you can cook now'
								}
								aria-pressed={makeableOnly}
								className={cn(
									'flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors',
									makeableOnly
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-border/50 bg-secondary/50 text-muted-foreground hover:bg-secondary',
								)}
							>
								<Icon name={makeableOnly ? 'check' : 'cookie'} size="xs" />
								Ready to cook ({matchData.makeableCount})
							</button>
						)}
						{/* Active filter summary */}
						{hasFilters && (
							<div className="text-muted-foreground text-xs">
								{displayRecipes.length} of {totalRecipeCount}{' '}
								{totalRecipeCount === 1 ? 'recipe' : 'recipes'}
								<span className="mx-2">·</span>
								<button
									type="button"
									onClick={handleClearFilters}
									className="text-muted-foreground hover:text-foreground font-medium"
								>
									Clear filters
								</button>
							</div>
						)}
					</div>
				</div>

				<div className="mb-4">
					<InviteCodeBanner />
				</div>
				<GettingStartedChecklist onboarding={onboarding} />

				{/* Recipe Grid */}
				{displayRecipes.length > 0 ? (
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
								isFavorite={recipe.isFavorite}
								isAiGenerated={recipe.isAiGenerated}
								lastCookedAt={
									recipe.cookingLogs[0]?.cookedAt?.toISOString() ?? null
								}
								cookCount={recipe._count.cookingLogs}
								matchPercentage={matchLookup?.get(recipe.id)?.matchPercentage}
							/>
						))}
					</RecipeCardGrid>
				) : matchData ? (
					<MatchEmptyState
						inventoryItemCount={matchData.inventoryItemCount}
						makeableOnly={makeableOnly}
						onShowAll={handleMakeableToggle}
					/>
				) : hasFilters ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
							<Icon
								name="magnifying-glass"
								className="text-muted-foreground/40 size-8"
							/>
						</div>
						<h2 className="mt-4 text-xl font-semibold">
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
						<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
							<Icon name="cookie" className="text-muted-foreground/40 size-8" />
						</div>
						<h2 className="mt-4 text-xl font-semibold">
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
									Import
								</Link>
							</Button>
							{isProActive && loaderData.hasInventory && (
								<Button asChild variant="outline">
									<Link to="/recipes/generate">
										<Icon name="sparkles" size="sm" />
										Generate from Inventory
									</Link>
								</Button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
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
				<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
					<Icon name="file-text" className="text-muted-foreground/40 size-8" />
				</div>
				<h2 className="mt-4 text-xl font-semibold">What's in your kitchen?</h2>
				<p className="text-muted-foreground mt-2 max-w-sm">
					Add what's in your pantry, fridge, and freezer. We'll highlight which
					recipes you can cook with what you already have.
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
			<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
				<Icon
					name="magnifying-glass"
					className="text-muted-foreground/40 size-8"
				/>
			</div>
			<h2 className="mt-4 text-xl font-semibold">
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
				{makeableOnly && <Button onClick={onShowAll}>Show All Recipes</Button>}
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
