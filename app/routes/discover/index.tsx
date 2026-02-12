import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { addDays } from 'date-fns'
import { Img } from 'openimg/react'
import { useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { MatchProgressRing } from '#app/components/match-progress-ring.tsx'
import {
	RecipeMatchCard,
	RecipeMatchCardGrid,
} from '#app/components/recipe-match-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	getCanonicalIngredientName,
	ingredientMatchesInventoryItem,
	matchRecipesWithInventory,
	type RecipeMatch,
} from '#app/utils/recipe-matching.server.ts'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Discover Recipes | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)

	// Load user's inventory
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	// Load all user's recipes with ingredients
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
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
		cookingStats,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'addMissing') {
		const recipeIdsParam = formData.get('recipeIds')
		if (typeof recipeIdsParam !== 'string' || !recipeIdsParam) {
			return { status: 'error' as const, addedCount: 0 }
		}

		const recipeIds = recipeIdsParam.split(',').filter(Boolean)
		if (recipeIds.length === 0) {
			return { status: 'error' as const, addedCount: 0 }
		}

		// Fetch the requested recipes with ingredients
		const recipes = await prisma.recipe.findMany({
			where: { id: { in: recipeIds }, householdId },
			include: { ingredients: true, image: { select: { objectKey: true } } },
		})

		// Fetch inventory items
		const inventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})

		// Re-compute matching server-side for accuracy
		const matches = matchRecipesWithInventory(recipes, inventoryItems)

		// Collect all missing ingredients, deduplicate via canonical name
		const missingByCanonical = new Map<string, string>()
		for (const match of matches) {
			for (const ing of match.missingIngredients) {
				const canonical = getCanonicalIngredientName(ing.name)
				if (!missingByCanonical.has(canonical)) {
					missingByCanonical.set(canonical, ing.name)
				}
			}
		}

		if (missingByCanonical.size === 0) {
			return { status: 'success' as const, addedCount: 0 }
		}

		// Get or create shopping list
		let shoppingList = await prisma.shoppingList.findFirst({
			where: { householdId },
			include: { items: { where: { checked: false } } },
		})

		if (!shoppingList) {
			shoppingList = await prisma.shoppingList.create({
				data: { userId, householdId },
				include: { items: { where: { checked: false } } },
			})
		}

		// Check existing items to avoid duplicates
		const existingCanonicals = new Set(
			shoppingList.items.map((item) => getCanonicalIngredientName(item.name)),
		)

		const itemsToAdd = [...missingByCanonical.entries()]
			.filter(([canonical]) => !existingCanonicals.has(canonical))
			.map(([, originalName]) => ({
				name: originalName,
				category: guessCategory(originalName),
				source: 'discover',
				listId: shoppingList.id,
			}))

		if (itemsToAdd.length > 0) {
			await prisma.shoppingListItem.createMany({ data: itemsToAdd })

			void emitHouseholdEvent({
				type: 'shopping_list_item_added',
				payload: { count: itemsToAdd.length, source: 'discover' },
				userId,
				householdId,
			})
		}

		return { status: 'success' as const, addedCount: itemsToAdd.length }
	}

	return { status: 'error' as const, addedCount: 0 }
}

export default function DiscoverIndex({ loaderData }: Route.ComponentProps) {
	const {
		matches,
		inventoryItemCount,
		recipeCount,
		expiringMatches,
		expiringItemCount,
		expiringItems,
		cookingStats,
	} = loaderData
	const [showOnlyMakeable, setShowOnlyMakeable] = useState(false)
	const fetcher = useFetcher<typeof action>()
	const prevFetcherState = useRef(fetcher.state)

	// Show toast when fetcher transitions from loading → idle with success
	if (
		prevFetcherState.current === 'loading' &&
		fetcher.state === 'idle' &&
		fetcher.data?.status === 'success'
	) {
		const count = fetcher.data.addedCount
		if (count > 0) {
			toast.success(
				`Added ${count} item${count === 1 ? '' : 's'} to your shopping list`,
			)
		} else {
			toast.info('All items are already on your shopping list')
		}
	}
	prevFetcherState.current = fetcher.state

	const displayMatches = showOnlyMakeable
		? matches.filter((m) => m.canMake)
		: matches

	const makeableCount = matches.filter((m) => m.canMake).length

	// Near-matches: recipes missing 1-3 ingredients
	const nearMatches = matches.filter(
		(m) =>
			!m.canMake &&
			m.missingIngredients.length > 0 &&
			m.missingIngredients.length <= 3,
	)
	const uniqueMissingNames = [
		...new Set(
			nearMatches.flatMap((m) =>
				m.missingIngredients.map((i) => i.name.toLowerCase()),
			),
		),
	]

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-gradient-to-b">
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
					<div className="border-accent/10 bg-accent/5 mb-8 rounded-2xl border p-6">
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
						{/* Expiring item pills */}
						<div className="mb-4 flex flex-wrap gap-2">
							{expiringItems.map((item) => {
								const isUrgent = item.daysUntilExpiry <= 1
								return (
									<span
										key={item.id}
										className={cn(
											'rounded-full px-3 py-1 text-xs font-medium',
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
												: `${item.daysUntilExpiry} days`}
										)
									</span>
								)
							})}
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

				{/* Stats & Filter */}
				{inventoryItemCount > 0 && recipeCount > 0 ? (
					<>
						<div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
							<div className="flex flex-wrap gap-4 text-sm">
								<div>
									<span className="text-lg font-bold">{makeableCount}</span>{' '}
									recipes you can make
								</div>
								<div className="text-muted-foreground">
									<span className="text-lg font-bold">
										{inventoryItemCount}
									</span>{' '}
									items in inventory
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

						{/* Almost There Banner */}
						{nearMatches.length > 0 && !showOnlyMakeable && (
							<div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
								<div>
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-center gap-2">
											<Icon
												name="star"
												className="size-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
											/>
											<h2 className="font-semibold text-emerald-900 dark:text-emerald-100">
												Almost there
											</h2>
										</div>
										<fetcher.Form method="POST" className="hidden shrink-0 sm:block">
											<input
												type="hidden"
												name="intent"
												value="addMissing"
											/>
											<input
												type="hidden"
												name="recipeIds"
												value={nearMatches
													.map((m) => m.recipe.id)
													.join(',')}
											/>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
												disabled={fetcher.state !== 'idle'}
											>
												<Icon name="plus" size="sm" />
												{fetcher.state !== 'idle'
													? 'Adding...'
													: 'Add to shopping list'}
											</Button>
										</fetcher.Form>
									</div>
									<div>
										<p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
											You're{' '}
											<span className="font-semibold">
												{uniqueMissingNames.length} ingredient
												{uniqueMissingNames.length !== 1 ? 's' : ''}
											</span>{' '}
											away from making{' '}
											<span className="font-semibold">
												{nearMatches.length} recipe
												{nearMatches.length !== 1 ? 's' : ''}
											</span>
										</p>
										<div className="mt-2.5 flex flex-wrap gap-1.5">
											{uniqueMissingNames.slice(0, 8).map((name) => (
												<span
													key={name}
													className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
												>
													{name}
												</span>
											))}
											{uniqueMissingNames.length > 8 && (
												<span className="text-xs leading-5 text-emerald-600 dark:text-emerald-400">
													+{uniqueMissingNames.length - 8} more
												</span>
											)}
										</div>
									</div>
									<fetcher.Form method="POST" className="mt-3 sm:hidden">
										<input
											type="hidden"
											name="intent"
											value="addMissing"
										/>
										<input
											type="hidden"
											name="recipeIds"
											value={nearMatches
												.map((m) => m.recipe.id)
												.join(',')}
										/>
										<Button
											type="submit"
											size="sm"
											variant="outline"
											className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
											disabled={fetcher.state !== 'idle'}
										>
											<Icon name="plus" size="sm" />
											{fetcher.state !== 'idle'
												? 'Adding...'
												: 'Add to shopping list'}
										</Button>
									</fetcher.Form>
								</div>
							</div>
						)}

						{/* Recipe Matches */}
						{displayMatches.length > 0 ? (
							(() => {
								const heroMatch =
									displayMatches[0]!.matchPercentage > 0
										? displayMatches[0]!
										: null
								const gridMatches = heroMatch
									? displayMatches.slice(1)
									: displayMatches
								return (
									<>
										{/* Hero Card — top match */}
										{heroMatch && (
											<HeroMatchCard
												match={heroMatch}
												cookingStats={cookingStats}
											/>
										)}

										{/* Grid — remaining matches */}
										{gridMatches.length > 0 ? (
											<RecipeMatchCardGrid>
												{gridMatches.map((match) => (
													<RecipeMatchCard
														key={match.recipe.id}
														match={match}
														lastCookedAt={
															cookingStats[match.recipe.id]?.lastCookedAt
														}
														cookCount={cookingStats[match.recipe.id]?.cookCount}
													/>
												))}
											</RecipeMatchCardGrid>
										) : (
											<p className="text-muted-foreground py-8 text-center text-sm">
												This is your only recipe match — add more recipes to see
												more suggestions.
											</p>
										)}
									</>
								)
							})()
						) : (
							<div className="flex flex-col items-center justify-center py-16 text-center">
								<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
									<Icon
										name="magnifying-glass"
										className="text-accent/50 size-10"
									/>
								</div>
								<h2 className="mt-4 font-serif text-xl font-semibold">
									{showOnlyMakeable
										? 'No perfect matches yet'
										: 'No recipes match your filter'}
								</h2>
								<p className="text-muted-foreground mt-2 max-w-sm">
									{showOnlyMakeable
										? "None of your recipes match what's in your kitchen right now. Time to go shopping or add new recipes?"
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
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon name="cookie" className="text-accent/50 size-10" />
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
							Let's get cooking
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Add some recipes and stock your pantry — then we'll show you what
							you can make tonight.
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
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon name="file-text" className="text-accent/50 size-10" />
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
							What's in your kitchen?
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							You've got recipes — now tell us what's in your pantry, fridge,
							and freezer so we can match them up.
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
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon name="pencil-1" className="text-accent/50 size-10" />
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
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

function HeroMatchCard({
	match,
	cookingStats,
}: {
	match: RecipeMatch
	cookingStats: Record<
		string,
		{ lastCookedAt: string | null; cookCount: number }
	>
}) {
	const { recipe, matchPercentage, canMake, missingIngredients } = match
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const placeholder = getRecipePlaceholder(recipe.title)
	const stats = cookingStats[recipe.id]

	return (
		<div className="mb-6">
			<p className="text-accent mb-2 font-serif text-sm font-medium md:hidden">
				Tonight's Pick
			</p>
			<Link
				to={`/recipes/${recipe.id}`}
				className="bg-card group shadow-warm-lg block overflow-hidden rounded-2xl"
			>
				{/* Image area */}
				<div className="relative aspect-[2/1] overflow-hidden">
					{recipe.image?.objectKey ? (
						<Img
							src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
							alt={recipe.title}
							className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
							width={800}
							height={400}
						/>
					) : (
						<div
							role="img"
							aria-label={`${recipe.title} recipe`}
							className={cn(
								'flex h-full w-full items-center justify-center',
								placeholder.bgClass,
							)}
						>
							<div className="flex flex-col items-center gap-3">
								<span
									className={cn(
										'text-8xl font-bold',
										placeholder.letterColorClass,
									)}
								>
									{placeholder.letter}
								</span>
								<Icon
									name={placeholder.iconName}
									className={cn('size-12', placeholder.iconColorClass)}
								/>
							</div>
						</div>
					)}
					{/* Gradient scrim */}
					<div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
					{/* Title overlay */}
					<h3 className="absolute right-16 bottom-4 left-5 text-xl font-bold text-white drop-shadow-lg md:text-2xl">
						{recipe.title}
					</h3>
					{/* Progress ring */}
					<div className="absolute top-3 right-3">
						<div className="rounded-full bg-white/80 p-1 shadow-lg backdrop-blur-sm dark:bg-black/60">
							<MatchProgressRing percentage={matchPercentage} size={48} />
						</div>
					</div>
				</div>

				{/* Card body */}
				<div className="flex flex-wrap items-center gap-3 p-5">
					{canMake ? (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
							<Icon name="check" className="size-3.5" />
							You have everything you need
						</span>
					) : (
						<span className="text-muted-foreground text-sm">
							Missing {missingIngredients.length} ingredient
							{missingIngredients.length !== 1 && 's'}
						</span>
					)}
					{totalTime > 0 && (
						<span className="text-muted-foreground flex items-center gap-1 text-sm">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{stats && stats.cookCount > 0 && stats.lastCookedAt && (
						<span className="text-muted-foreground text-xs">
							Made {stats.cookCount} {stats.cookCount === 1 ? 'time' : 'times'}
						</span>
					)}
					<span className="bg-primary text-primary-foreground ml-auto rounded-full px-4 py-1.5 text-sm font-medium transition-colors group-hover:opacity-90">
						Let's Cook
					</span>
				</div>
			</Link>
		</div>
	)
}
