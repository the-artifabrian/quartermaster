import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { addDays } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router'
import {
	RecipeMatchCard,
	RecipeMatchCardGrid,
} from '#app/components/recipe-match-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	ingredientMatchesInventoryItem,
	matchRecipesWithInventory,
	type RecipeMatch,
} from '#app/utils/recipe-matching.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Discover Recipes | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)

	// Load user's inventory
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { userId },
	})

	// Load all user's recipes with ingredients
	const recipes = await prisma.recipe.findMany({
		where: { userId },
		select: {
			id: true,
			title: true,
			description: true,
			prepTime: true,
			cookTime: true,
			servings: true,
			isFavorite: true,
			sourceUrl: true,
			rawText: true,
			notes: true,
			householdId: true,
			createdAt: true,
			updatedAt: true,
			userId: true,
			image: { select: { objectKey: true } },
			tags: { select: { id: true, name: true } },
			ingredients: {
				select: {
					id: true,
					name: true,
					amount: true,
					unit: true,
					notes: true,
					order: true,
					recipeId: true,
				},
				orderBy: { order: 'asc' },
			},
			cookingLogs: {
				select: { cookedAt: true },
				orderBy: { cookedAt: 'desc' as const },
				take: 1,
			},
			_count: { select: { cookingLogs: true } },
		},
	})

	// Calculate matches
	const matches = matchRecipesWithInventory(recipes, inventoryItems)

	// Find items expiring within 7 days
	const now = new Date()
	const sevenDaysFromNow = addDays(now, 7)
	const expiringItems = inventoryItems.filter(
		(item) =>
			item.expiresAt &&
			new Date(item.expiresAt) >= now &&
			new Date(item.expiresAt) <= sevenDaysFromNow,
	)

	// Find recipes that use expiring ingredients, sorted by how many they use
	let expiringMatches: Array<RecipeMatch & { expiringCount: number }> = []
	if (expiringItems.length > 0) {
		expiringMatches = matches
			.map((match) => {
				const expiringCount = match.recipe.ingredients.filter((ing) =>
					expiringItems.some((item) =>
						ingredientMatchesInventoryItem(ing, item),
					),
				).length
				return { ...match, expiringCount }
			})
			.filter((m) => m.expiringCount > 0)
			.sort((a, b) => b.expiringCount - a.expiringCount)
			.slice(0, 6)
	}

	const cookingStats: Record<
		string,
		{ lastCookedAt: string | null; cookCount: number }
	> = {}
	for (const recipe of recipes) {
		cookingStats[recipe.id] = {
			lastCookedAt: recipe.cookingLogs[0]?.cookedAt?.toISOString() ?? null,
			cookCount: recipe._count.cookingLogs,
		}
	}

	return {
		matches,
		inventoryItemCount: inventoryItems.length,
		recipeCount: recipes.length,
		expiringMatches,
		expiringItemCount: expiringItems.length,
		cookingStats,
	}
}

export default function DiscoverIndex({ loaderData }: Route.ComponentProps) {
	const {
		matches,
		inventoryItemCount,
		recipeCount,
		expiringMatches,
		expiringItemCount,
		cookingStats,
	} = loaderData
	const [showOnlyMakeable, setShowOnlyMakeable] = useState(false)

	const displayMatches = showOnlyMakeable
		? matches.filter((m) => m.canMake)
		: matches

	const makeableCount = matches.filter((m) => m.canMake).length

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="bg-muted/30">
				<div className="container py-6">
					<h1 className="text-2xl font-bold">Discover Recipes</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						See what you can make with your current inventory
					</p>
				</div>
			</div>

			<div className="container py-6">
				{/* Expiring Items Suggestions */}
				{expiringMatches.length > 0 && (
					<div className="mb-8">
						<div className="mb-4 flex items-center gap-2">
							<Icon name="clock" className="size-5 text-amber-500" />
							<div>
								<h2 className="text-lg font-semibold">
									Use It Before You Lose It
								</h2>
								<p className="text-muted-foreground text-sm">
									{expiringItemCount}{' '}
									{expiringItemCount === 1 ? 'item' : 'items'} expiring within 7
									days
								</p>
							</div>
						</div>
						<RecipeMatchCardGrid>
							{expiringMatches.map((match) => (
								<RecipeMatchCard
									key={match.recipe.id}
									match={match}
									lastCookedAt={cookingStats[match.recipe.id]?.lastCookedAt}
									cookCount={cookingStats[match.recipe.id]?.cookCount}
								/>
							))}
						</RecipeMatchCardGrid>
					</div>
				)}

				{/* Stats & Filter */}
				{inventoryItemCount > 0 && recipeCount > 0 ? (
					<>
						<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
							<div className="flex flex-wrap gap-4 text-sm">
								<div>
									<span className="font-medium">{makeableCount}</span> recipes
									you can make
								</div>
								<div className="text-muted-foreground">
									{inventoryItemCount} items in inventory
								</div>
							</div>
							<Button
								variant={showOnlyMakeable ? 'default' : 'outline'}
								size="sm"
								onClick={() => setShowOnlyMakeable(!showOnlyMakeable)}
							>
								<Icon name={showOnlyMakeable ? 'check' : 'cookie'} size="sm" />
								{showOnlyMakeable ? 'Showing Makeable' : 'Show Only Makeable'}
							</Button>
						</div>

						{/* Recipe Matches */}
						{displayMatches.length > 0 ? (
							<RecipeMatchCardGrid>
								{displayMatches.map((match) => (
									<RecipeMatchCard
										key={match.recipe.id}
										match={match}
										lastCookedAt={cookingStats[match.recipe.id]?.lastCookedAt}
										cookCount={cookingStats[match.recipe.id]?.cookCount}
									/>
								))}
							</RecipeMatchCardGrid>
						) : (
							<div className="flex flex-col items-center justify-center py-16 text-center">
								<div className="bg-muted/50 flex size-20 items-center justify-center rounded-full">
									<Icon
										name="magnifying-glass"
										className="text-muted-foreground size-10"
									/>
								</div>
								<h2 className="mt-4 text-xl font-semibold">
									No recipes match your filter
								</h2>
								<p className="text-muted-foreground mt-2 max-w-sm">
									{showOnlyMakeable
										? "You don't have all the ingredients for any recipes yet. Try adding more items to your inventory."
										: 'Try adjusting your filters.'}
								</p>
								<div className="mt-6 flex gap-3">
									{showOnlyMakeable && (
										<Button onClick={() => setShowOnlyMakeable(false)}>
											Show All Recipes
										</Button>
									)}
									<Button variant="outline" asChild>
										<Link to="/inventory">
											<Icon name="plus" size="sm" />
											Add to Inventory
										</Link>
									</Button>
								</div>
							</div>
						)}
					</>
				) : inventoryItemCount === 0 && recipeCount === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-muted/50 flex size-20 items-center justify-center rounded-full">
							<Icon name="cookie" className="text-muted-foreground size-10" />
						</div>
						<h2 className="mt-4 text-xl font-semibold">
							Ready to discover what you can cook?
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Add some recipes and track your inventory. We'll match them up and
							show you what's possible.
						</p>
						<div className="mt-6 flex gap-3">
							<Button asChild>
								<Link to="/recipes/new">
									<Icon name="plus" size="sm" />
									Add Recipe
								</Link>
							</Button>
							<Button variant="outline" asChild>
								<Link to="/inventory">
									<Icon name="plus" size="sm" />
									Add to Inventory
								</Link>
							</Button>
						</div>
					</div>
				) : inventoryItemCount === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-muted/50 flex size-20 items-center justify-center rounded-full">
							<Icon
								name="file-text"
								className="text-muted-foreground size-10"
							/>
						</div>
						<h2 className="mt-4 text-xl font-semibold">
							What's in your kitchen?
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Track what's in your pantry, fridge, and freezer so we can match
							it against your recipes.
						</p>
						<Button asChild className="mt-6">
							<Link to="/inventory">
								<Icon name="plus" size="sm" />
								Add to Inventory
							</Link>
						</Button>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-muted/50 flex size-20 items-center justify-center rounded-full">
							<Icon name="pencil-1" className="text-muted-foreground size-10" />
						</div>
						<h2 className="mt-4 text-xl font-semibold">
							Add your first recipe
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							You have {inventoryItemCount} items in your inventory. Add some
							recipes and we'll tell you what you can make.
						</p>
						<Button asChild className="mt-6">
							<Link to="/recipes/new">
								<Icon name="plus" size="sm" />
								Add Recipe
							</Link>
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
