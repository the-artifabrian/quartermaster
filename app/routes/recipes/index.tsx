import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, useSearchParams } from 'react-router'
import { RecipeCard, RecipeCardGrid } from '#app/components/recipe-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { useDebounce } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const search = url.searchParams.get('search') ?? ''
	const tagsParam = url.searchParams.get('tags') ?? ''
	const selectedTagIds = tagsParam ? tagsParam.split(',').filter(Boolean) : []

	const recipes = await prisma.recipe.findMany({
		where: {
			userId,
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
			image: { select: { objectKey: true } },
			tags: { select: { id: true, name: true } },
		},
		orderBy: { updatedAt: 'desc' },
	})

	const tags = await prisma.tag.findMany({
		select: { id: true, name: true, category: true },
		orderBy: [{ category: 'asc' }, { name: 'asc' }],
	})

	return { recipes, tags, search, selectedTagIds }
}

export default function RecipesIndex({ loaderData }: Route.ComponentProps) {
	const { recipes, tags, search, selectedTagIds } = loaderData
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

	return (
		<div className="container py-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold">My Recipes</h1>
				<Button asChild>
					<Link to="/recipes/new">
						<Icon name="plus" size="sm" />
						New Recipe
					</Link>
				</Button>
			</div>

			{/* Search & Filters */}
			<div className="mb-6 space-y-4">
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
						className="pl-10"
					/>
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
								className={`rounded-full px-3 py-1 text-sm transition-colors ${
									isSelected
										? 'bg-primary text-primary-foreground'
										: 'bg-secondary hover:bg-secondary/80'
								}`}
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
						/>
					))}
				</RecipeCardGrid>
			) : (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<Icon name="cookie" className="text-muted-foreground size-16" />
					<h2 className="mt-4 text-xl font-semibold">No recipes yet</h2>
					<p className="text-muted-foreground mt-2">
						{search || selectedTagIds.length > 0
							? 'No recipes match your search. Try different filters.'
							: "Start by adding your first recipe. It's easy!"}
					</p>
					{!search && selectedTagIds.length === 0 && (
						<Button asChild className="mt-6">
							<Link to="/recipes/new">
								<Icon name="plus" size="sm" />
								Add Your First Recipe
							</Link>
						</Button>
					)}
				</div>
			)}
		</div>
	)
}
