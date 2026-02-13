import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, useSearchParams } from 'react-router'
import { GettingStartedChecklist } from '#app/components/getting-started-checklist.tsx'
import {
	RecipeCard,
	RecipeCardGrid,
	RecipeListRow,
	getTagCategoryClass,
} from '#app/components/recipe-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn, useDebounce } from '#app/utils/misc.tsx'
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
	const { householdId } = await requireUserWithHousehold(request)
	const url = new URL(request.url)
	const search = url.searchParams.get('search') ?? ''
	const tagsParam = url.searchParams.get('tags') ?? ''
	const selectedTagIds = tagsParam ? tagsParam.split(',').filter(Boolean) : []
	const sort = (url.searchParams.get('sort') ?? 'recent') as SortOption
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

	const [recipes, totalRecipeCount, inventoryCount, mealPlanEntryCount, allRecipesForQuality] =
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
					// Filter by ALL selected tags (AND logic)
					...(selectedTagIds.length > 0 && {
						AND: selectedTagIds.map((tagId) => ({
							tags: { some: { id: tagId } },
						})),
					}),
				},
				select: {
					id: true,
					title: true,
					description: true,
					prepTime: true,
					cookTime: true,
					isFavorite: true,
					image: { select: { objectKey: true } },
					tags: { select: { id: true, name: true, category: true } },
					cookingLogs: {
						select: { cookedAt: true },
						orderBy: { cookedAt: 'desc' as const },
						take: 1,
					},
					_count: { select: { cookingLogs: true } },
				},
				orderBy,
			}),
			prisma.recipe.count({ where: { householdId } }),
			prisma.inventoryItem.count({ where: { householdId } }),
			prisma.mealPlanEntry.count({
				where: { mealPlan: { householdId } },
			}),
			prisma.recipe.findMany({
				where: { householdId },
				select: {
					id: true,
					title: true,
					_count: { select: { ingredients: true, instructions: true } },
				},
			}),
		])

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

	const tags = await prisma.tag.findMany({
		select: { id: true, name: true, category: true },
		orderBy: [{ category: 'asc' }, { name: 'asc' }],
	})

	return {
		recipes: filteredRecipes,
		tags,
		search,
		selectedTagIds,
		favoritesOnly,
		maxTime,
		sort,
		view,
		totalRecipeCount,
		flaggedCount,
		quality,
		onboarding: {
			hasRecipes: totalRecipeCount > 0,
			hasInventory: inventoryCount > 0,
			hasMealPlan: mealPlanEntryCount > 0,
		},
	}
}

export default function RecipesIndex({ loaderData }: Route.ComponentProps) {
	const {
		recipes,
		tags,
		search,
		selectedTagIds,
		favoritesOnly,
		maxTime,
		sort,
		view,
		totalRecipeCount,
		flaggedCount,
		quality,
		onboarding,
	} = loaderData
	const [searchParams, setSearchParams] = useSearchParams()

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

	const handleTagClick = (tagId: string) => {
		const params = new URLSearchParams(searchParams)
		const currentTags = selectedTagIds

		// Toggle tag selection
		const newTags = currentTags.includes(tagId)
			? currentTags.filter((id) => id !== tagId)
			: [...currentTags, tagId]

		if (newTags.length > 0) {
			params.set('tags', newTags.join(','))
		} else {
			params.delete('tags')
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

	const hasFilters =
		search || selectedTagIds.length > 0 || favoritesOnly || maxTime || quality

	const handleClearFilters = () => {
		// Preserve sort and view when clearing filters
		const params = new URLSearchParams()
		if (sort !== 'recent') params.set('sort', sort)
		if (view === 'list') params.set('view', 'list')
		// quality param is cleared along with other filters
		setSearchParams(params, { replace: true })
	}

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-linear-to-b">
				<div className="container flex flex-col gap-3 py-6 md:flex-row md:items-center md:justify-between">
					<div>
						<h1 className="text-2xl font-bold">My Recipes</h1>
						<p className="text-muted-foreground mt-1 text-sm">
							{totalRecipeCount} {totalRecipeCount === 1 ? 'recipe' : 'recipes'}
						</p>
					</div>
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

			<div className="container py-6">
				{/* Search & Filters */}
				<div className="bg-card border-border/50 shadow-warm mb-6 space-y-4 rounded-2xl border p-4">
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
							className="bg-card border-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
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
							className="bg-card border-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
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
									'rounded-md p-2 transition-colors',
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
									'rounded-md p-2 transition-colors',
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

					{/* Tag filters */}
					<div className="flex flex-wrap gap-2">
						{tags.map((tag) => {
							const isSelected = selectedTagIds.includes(tag.id)
							return (
								<button
									key={tag.id}
									type="button"
									onClick={() => handleTagClick(tag.id)}
									aria-pressed={isSelected}
									className={cn(
										'rounded-full border px-3 py-1.5 text-sm transition-colors',
										isSelected
											? 'bg-accent text-accent-foreground shadow-sm'
											: getTagCategoryClass(tag.category),
									)}
								>
									{tag.name}
									{isSelected && (
										<span className="ml-1 font-bold" aria-hidden="true">
											×
										</span>
									)}
								</button>
							)
						})}
					</div>

					{/* Active filter summary */}
					{hasFilters && (
						<div className="text-muted-foreground text-sm">
							{recipes.length} of {totalRecipeCount}{' '}
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

				<GettingStartedChecklist onboarding={onboarding} />

				{flaggedCount > 0 && quality !== 'flagged' && (
					<div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
						<Icon
							name="question-mark-circled"
							className="size-5 flex-shrink-0 text-amber-500"
						/>
						<p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-200">
							<span className="font-semibold">{flaggedCount} recipe{flaggedCount === 1 ? '' : 's'}</span>{' '}
							may need a quick review — missing ingredients, instructions, or possible duplicates
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
							Showing {recipes.length} recipe{recipes.length === 1 ? '' : 's'} that may need review
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

				{/* Recipe Grid / List */}
				{recipes.length > 0 ? (
					view === 'list' ? (
						<div className="space-y-2">
							{recipes.map((recipe) => (
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
								/>
							))}
						</div>
					) : (
						<RecipeCardGrid>
							{recipes.map((recipe) => (
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
								/>
							))}
						</RecipeCardGrid>
					)
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
