import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import {
	RecipeMatchCard,
	RecipeMatchCardGrid,
} from '#app/components/recipe-match-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { matchRecipesWithInventory } from '#app/utils/recipe-matching.server.ts'
import { type Route } from './+types/index.ts'
import { Link } from 'react-router'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
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
		},
	})

	// Calculate matches
	const matches = matchRecipesWithInventory(recipes, inventoryItems)

	return {
		matches,
		inventoryItemCount: inventoryItems.length,
		recipeCount: recipes.length,
	}
}

export default function DiscoverIndex({ loaderData }: Route.ComponentProps) {
	const { matches, inventoryItemCount, recipeCount } = loaderData
	const [showOnlyMakeable, setShowOnlyMakeable] = useState(false)

	const displayMatches = showOnlyMakeable
		? matches.filter((m) => m.canMake)
		: matches

	const makeableCount = matches.filter((m) => m.canMake).length

	return (
		<div className="container py-6 pb-20 md:pb-6">
			{/* Header */}
			<div className="mb-6">
				<h1 className="text-2xl font-bold">Discover Recipes</h1>
				<p className="mt-2 text-muted-foreground">
					See what you can make with your current inventory
				</p>
			</div>

			{/* Stats & Filter */}
			{inventoryItemCount > 0 && recipeCount > 0 ? (
				<>
					<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
						<div className="flex flex-wrap gap-4 text-sm">
							<div>
								<span className="font-medium">{makeableCount}</span> recipes you
								can make
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
							<Icon
								name={showOnlyMakeable ? 'check' : 'cookie'}
								size="sm"
							/>
							{showOnlyMakeable ? 'Showing Makeable' : 'Show Only Makeable'}
						</Button>
					</div>

					{/* Recipe Matches */}
					{displayMatches.length > 0 ? (
						<RecipeMatchCardGrid>
							{displayMatches.map((match) => (
								<RecipeMatchCard key={match.recipe.id} match={match} />
							))}
						</RecipeMatchCardGrid>
					) : (
						<div className="flex flex-col items-center justify-center py-16 text-center">
							<Icon name="cookie" className="size-16 text-muted-foreground" />
							<h2 className="mt-4 text-xl font-semibold">
								No recipes match your filter
							</h2>
							<p className="mt-2 text-muted-foreground">
								{showOnlyMakeable
									? "You don't have all the ingredients for any recipes yet. Try adding more items to your inventory!"
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
					<Icon name="cookie" className="size-16 text-muted-foreground" />
					<h2 className="mt-4 text-xl font-semibold">Get Started</h2>
					<p className="mt-2 text-muted-foreground max-w-md">
						Add recipes and track your inventory to discover what you can make!
					</p>
					<div className="mt-6 flex gap-3">
						<Button asChild>
							<Link to="/recipes/new">
								<Icon name="plus" size="sm" />
								Add Recipe
							</Link>
						</Button>
						<Button variant="outline" asChild>
							<Link to="/inventory/new">
								<Icon name="plus" size="sm" />
								Add to Inventory
							</Link>
						</Button>
					</div>
				</div>
			) : inventoryItemCount === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<Icon name="cookie" className="size-16 text-muted-foreground" />
					<h2 className="mt-4 text-xl font-semibold">Add Your Inventory</h2>
					<p className="mt-2 text-muted-foreground max-w-md">
						Track what's in your pantry, fridge, and freezer to see what recipes
						you can make!
					</p>
					<Button asChild className="mt-6">
						<Link to="/inventory/new">
							<Icon name="plus" size="sm" />
							Add to Inventory
						</Link>
					</Button>
				</div>
			) : (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<Icon name="cookie" className="size-16 text-muted-foreground" />
					<h2 className="mt-4 text-xl font-semibold">Add Recipes</h2>
					<p className="mt-2 text-muted-foreground max-w-md">
						Add your favorite recipes to see which ones you can make with your
						current inventory!
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
	)
}
