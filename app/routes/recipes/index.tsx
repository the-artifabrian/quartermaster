import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { GettingStartedChecklist } from '#app/components/getting-started-checklist.tsx'
import { LibrarySwitch } from '#app/components/library-switch.tsx'
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
import { recipeSearchWhere } from '#app/utils/recipe-search.server.ts'
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
	{ value: 'alphabetical', label: 'Alphabetical' },
	{ value: 'newest', label: 'Newest First' },
] as const

type SortOption = (typeof SORT_OPTIONS)[number]['value']

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { isProActive } = await getUserTier(userId)
	const url = new URL(request.url)
	// Trim so a whitespace-only query counts as "no search" — otherwise it is
	// truthy for hasFilters/UI but produces no filter terms.
	const search = url.searchParams.get('search')?.trim() ?? ''
	// Unknown values (e.g. removed sorts like 'most-cooked' in stale bookmarks
	// or PWA-restored URLs) count as "no explicit sort".
	const rawSort = url.searchParams.get('sort')
	const explicitSort = SORT_OPTIONS.some((o) => o.value === rawSort)
		? (rawSort as SortOption)
		: null
	const sort: SortOption = explicitSort ?? 'recent'
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

	const [householdAvailability, mealCount, totalRecipeCount] =
		await Promise.all([
			prisma.household.findUniqueOrThrow({
				where: { id: householdId },
				select: {
					staplesCutoverAt: true,
					_count: { select: { inventoryItems: true } },
				},
			}),
			isProActive
				? prisma.meal.count({
						where: { mealPlan: { householdId } },
					})
				: Promise.resolve(0),
			prisma.recipe.count({ where: { householdId } }),
		])

	const hasInventory =
		householdAvailability.staplesCutoverAt == null &&
		householdAvailability._count.inventoryItems > 0
	const hasAvailabilitySetup =
		hasInventory || householdAvailability.staplesCutoverAt != null

	const recipes = await prisma.recipe.findMany({
		where: {
			householdId,
			...(favoritesOnly && { isFavorite: true }),
			...(search && recipeSearchWhere(search)),
		},
		select: {
			id: true,
			title: true,
			description: true,
			totalTime: true,
			isFavorite: true,
			isAiGenerated: true,
			image: { select: { objectKey: true } },
			_count: {
				select: {
					ingredients: true,
					instructions: true,
				},
			},
		},
		orderBy,
	})

	// Recipes with unknown Total are included since unknown does not mean slow.
	let filteredRecipes = maxTime
		? recipes.filter((r) => {
				if (r.totalTime == null) return true
				return r.totalTime <= maxTime
			})
		: recipes

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
				r._count.ingredients === 0 ||
				r._count.instructions === 0 ||
				duplicateIds.has(r.id),
		)
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
			// A confirmed cutover completes the old Pantry onboarding step; the
			// archived rows must not resurrect its CTA.
			hasInventory: hasAvailabilitySetup,
			hasMealPlan: mealCount > 0,
		},
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

	const [filtersOpen, setFiltersOpen] = useState(false)
	// Controlled so "Clear search" in the no-results state empties the box too
	const [searchInput, setSearchInput] = useState(search)
	const activeFilterCount =
		(favoritesOnly ? 1 : 0) + (maxTime ? 1 : 0) + (sort !== 'recent' ? 1 : 0)

	const handleSearchChange = useDebounce((value: string) => {
		const params = new URLSearchParams(searchParams)
		if (value.trim()) {
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

	const hasFilters = search || favoritesOnly || maxTime

	const handleClearSearch = () => {
		setSearchInput('')
		const params = new URLSearchParams(searchParams)
		params.delete('search')
		setSearchParams(params, { replace: true })
	}

	const handleClearFilters = () => {
		// Preserve sort when clearing filters
		const params = new URLSearchParams()
		if (sort !== 'recent') params.set('sort', sort)
		setSearchParams(params, { replace: true })
	}

	const displayRecipes = recipes

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="border-border/50 border-b">
				<div className="container-grid flex items-center justify-between gap-3 py-3 md:py-4">
					<h1 className="font-serif text-2xl font-normal">
						My Recipes{' '}
						<span className="text-muted-foreground text-base font-normal">
							{/* While searching/filtering, the count says what you see (B2) */}
							{hasFilters && displayRecipes.length !== totalRecipeCount
								? `(${displayRecipes.length} of ${totalRecipeCount})`
								: `(${totalRecipeCount})`}
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
				<LibrarySwitch active="recipes" />

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
								value={searchInput}
								onChange={(e) => {
									setSearchInput(e.target.value)
									handleSearchChange(e.target.value)
								}}
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
								totalTime={recipe.totalTime}
								isFavorite={recipe.isFavorite}
								isAiGenerated={recipe.isAiGenerated}
							/>
						))}
					</RecipeCardGrid>
				) : search ? (
					// A failed *search* isn't a pantry problem: name the query and
					// offer the two real exits — clear it, or capture the recipe you
					// just failed to find.
					<SearchEmptyState query={search} onClearSearch={handleClearSearch} />
				) : hasFilters ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
							<Icon
								name="magnifying-glass"
								className="text-muted-foreground/40 size-8"
							/>
						</div>
						<h2 className="mt-4 font-serif text-xl font-normal">
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
						<h2 className="mt-4 font-serif text-xl font-normal">
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
										Generate from Pantry
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

function SearchEmptyState({
	query,
	onClearSearch,
}: {
	query: string
	onClearSearch: () => void
}) {
	return (
		<div className="flex flex-col items-center justify-center py-16 text-center">
			<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
				<Icon
					name="magnifying-glass"
					className="text-muted-foreground/40 size-8"
				/>
			</div>
			<h2 className="mt-4 font-serif text-xl font-normal">
				No recipes match &ldquo;{query}&rdquo;
			</h2>
			<p className="text-muted-foreground mt-2 max-w-sm">
				Check the spelling — or this might be the one your cookbook is missing.
			</p>
			<div className="mt-6 flex gap-3">
				<Button variant="outline" onClick={onClearSearch}>
					Clear search
				</Button>
				<Button asChild>
					<Link to="/recipes/import">
						<Icon name="link-2" size="sm" />
						Import a recipe
					</Link>
				</Button>
			</div>
		</div>
	)
}
