import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, useSearchParams } from 'react-router'
import { RecipeCard, RecipeCardGrid } from '#app/components/recipe-card.tsx'
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

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const url = new URL(request.url)
	const search = url.searchParams.get('search') ?? ''
	const tagsParam = url.searchParams.get('tags') ?? ''
	const selectedTagIds = tagsParam ? tagsParam.split(',').filter(Boolean) : []

	const favoritesOnly = url.searchParams.get('favorites') === 'true'
	const maxTime = url.searchParams.get('maxTime')
		? parseInt(url.searchParams.get('maxTime')!, 10)
		: null

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
			tags: { select: { id: true, name: true } },
			cookingLogs: {
				select: { cookedAt: true },
				orderBy: { cookedAt: 'desc' as const },
				take: 1,
			},
			_count: { select: { cookingLogs: true } },
		},
		orderBy: { updatedAt: 'desc' },
	})

	// Post-filter by total cook time (prepTime + cookTime).
	// Recipes with no time data (both null) are included since unknown ≠ slow.
	const filteredRecipes = maxTime
		? recipes.filter((r) => {
				const total = (r.prepTime ?? 0) + (r.cookTime ?? 0)
				if (total === 0) return true // no time data — don't exclude
				return total <= maxTime
			})
		: recipes

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
	}
}

export default function RecipesIndex({ loaderData }: Route.ComponentProps) {
	const { recipes, tags, search, selectedTagIds, favoritesOnly, maxTime } =
		loaderData
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

	const hasFilters =
		search || selectedTagIds.length > 0 || favoritesOnly || maxTime

	const handleClearFilters = () => {
		setSearchParams(new URLSearchParams(), { replace: true })
	}

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="bg-muted/30">
				<div className="container flex items-center justify-between py-6">
					<div>
						<h1 className="text-2xl font-bold">My Recipes</h1>
						<p className="text-muted-foreground mt-1 text-sm">
							{recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
						</p>
					</div>
					<div className="flex gap-2">
						<Button asChild variant="outline" size="sm">
							<Link to="/resources/surprise-me">
								<Icon name="shuffle" size="sm" />
								Surprise Me
							</Link>
						</Button>
						<DropdownMenu>
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
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>

			<div className="container py-6">
				{/* Search & Filters */}
				<div className="bg-muted/30 mb-6 space-y-4 rounded-xl p-4">
					<div className="flex gap-2">
						<div className="relative flex-1">
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
						<select
							value={maxTime?.toString() ?? ''}
							onChange={(e) => handleMaxTimeChange(e.target.value)}
							className="bg-background border-input rounded-md border px-3 py-2 text-sm"
						>
							<option value="">Any time</option>
							<option value="30">Under 30 min</option>
							<option value="60">Under 1 hour</option>
							<option value="120">Under 2 hours</option>
						</select>
						<Button
							variant={favoritesOnly ? 'default' : 'outline'}
							onClick={handleFavoritesToggle}
							title={favoritesOnly ? 'Show all recipes' : 'Show favorites only'}
							className={cn(!favoritesOnly && 'bg-background')}
						>
							<Icon name={favoritesOnly ? 'heart-filled' : 'heart'} size="sm" />
						</Button>
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
									className={cn(
										'rounded-full px-3 py-1 text-sm transition-colors',
										isSelected
											? 'bg-primary text-primary-foreground shadow-sm'
											: 'bg-secondary hover:bg-secondary/80',
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

					{/* Active filter info */}
					{hasFilters && (
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">
								{recipes.length} {recipes.length === 1 ? 'result' : 'results'}
							</span>
							<button
								type="button"
								onClick={handleClearFilters}
								className="text-primary hover:text-primary/80 text-sm font-medium"
							>
								Clear all filters
							</button>
						</div>
					)}
				</div>

				{/* Recipe Grid */}
				{recipes.length > 0 ? (
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
				) : hasFilters ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-muted/50 flex size-20 items-center justify-center rounded-full">
							<Icon
								name="magnifying-glass"
								className="text-muted-foreground size-10"
							/>
						</div>
						<h2 className="mt-4 text-xl font-semibold">No matches found</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							No recipes match your current filters. Try different search terms
							or tags.
						</p>
						<button
							type="button"
							onClick={handleClearFilters}
							className="text-primary hover:text-primary/80 mt-4 text-sm font-medium"
						>
							Clear all filters
						</button>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-muted/50 flex size-20 items-center justify-center rounded-full">
							<Icon name="cookie" className="text-muted-foreground size-10" />
						</div>
						<h2 className="mt-4 text-xl font-semibold">
							Your recipe book is empty
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Add your first recipe to get started. You can type it in manually
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
