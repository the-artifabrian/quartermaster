import { Img } from 'openimg/react'
import { Form, Link } from 'react-router'
import { MEAL_TYPE_LABELS, type MealType, serializeDate } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type TonightEntry = {
	id: string
	recipe: {
		id: string
		title: string
		prepTime: number | null
		cookTime: number | null
		servings: number | null
		image: { objectKey: string } | null
	}
	mealType: string
	servings: number | null
}

type TonightSuggestion = {
	id: string
	title: string
	image: { objectKey: string } | null
}

type TonightBannerProps = {
	entries: TonightEntry[]
	suggestion: TonightSuggestion | null
}

export function TonightBanner({
	entries,
	suggestion,
}: TonightBannerProps) {
	if (entries.length > 0) {
		return <HasMealsBanner entries={entries} />
	}

	return <EmptyBanner suggestion={suggestion} />
}

function HasMealsBanner({ entries }: { entries: TonightEntry[] }) {
	const primary = entries[0]!
	const recipe = primary.recipe
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const mealLabel = MEAL_TYPE_LABELS[primary.mealType as MealType] ?? primary.mealType
	const remaining = entries.length - 1

	return (
		<div className="mb-6 overflow-hidden rounded-2xl border border-amber-200/60 bg-gradient-to-r from-amber-50 to-orange-50 shadow-warm dark:border-amber-800/40 dark:from-amber-950/30 dark:to-orange-950/20">
			<div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
				{/* Recipe image */}
				<div className="bg-muted hidden size-16 shrink-0 overflow-hidden rounded-xl sm:block">
					{recipe.image?.objectKey ? (
						<Img
							src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
							alt={recipe.title}
							className="h-full w-full object-cover"
							width={64}
							height={64}
						/>
					) : (
						(() => {
							const placeholder = getRecipePlaceholder(recipe.title)
							return (
								<div
									className={cn(
										'flex h-full w-full items-center justify-center',
										placeholder.bgClass,
									)}
								>
									<span
										className={cn(
											'text-2xl font-bold',
											placeholder.letterColorClass,
										)}
									>
										{placeholder.letter}
									</span>
								</div>
							)
						})()
					)}
				</div>

				{/* Content */}
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium tracking-wide text-amber-700 dark:text-amber-400">
						{primary.mealType === 'dinner' || primary.mealType === 'snack'
							? 'Tonight'
							: 'Today'}{' '}
						&middot; {mealLabel}
					</p>
					<h3 className="truncate text-lg font-semibold">
						{recipe.title}
					</h3>
					<div className="text-muted-foreground flex items-center gap-3 text-xs">
						{totalTime > 0 && (
							<span className="flex items-center gap-1">
								<Icon name="clock" size="xs" />
								{totalTime} min
							</span>
						)}
						{(primary.servings ?? recipe.servings) && (
							<span>
								{primary.servings ?? recipe.servings} servings
							</span>
						)}
					</div>
					{remaining > 0 && (
						<p className="text-muted-foreground mt-1 text-xs">
							&amp; {remaining} more planned today
						</p>
					)}
				</div>

				{/* Action */}
				<Button asChild size="sm" className="shrink-0">
					<Link to={`/recipes/${recipe.id}?cooking=true`}>
						<Icon name="play" size="sm" />
						<span className="hidden sm:inline">Start Cooking</span>
						<span className="sm:hidden">Cook</span>
					</Link>
				</Button>
			</div>
		</div>
	)
}

function EmptyBanner({
	suggestion,
}: {
	suggestion: TonightSuggestion | null
}) {
	const today = serializeDate(new Date())

	return (
		<div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-r from-card to-muted/30 shadow-warm">
			<div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
				<div className="bg-muted hidden size-16 shrink-0 items-center justify-center rounded-xl sm:flex">
					<Icon name="cookie" className="text-muted-foreground/50 size-8" />
				</div>

				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">
						Nothing planned for today
					</p>
					{suggestion ? (
						<p className="text-muted-foreground mt-0.5 text-xs">
							How about{' '}
							<Link
								to={`/recipes/${suggestion.id}`}
								className="text-foreground underline decoration-dotted underline-offset-2"
							>
								{suggestion.title}
							</Link>
							?
						</p>
					) : (
						<p className="text-muted-foreground mt-0.5 text-xs">
							Browse your recipes or discover what you can make.
						</p>
					)}
				</div>

				{suggestion ? (
					<Form method="POST">
						<input type="hidden" name="intent" value="assign" />
						<input type="hidden" name="date" value={today} />
						<input type="hidden" name="mealType" value="dinner" />
						<input type="hidden" name="recipeId" value={suggestion.id} />
						<Button type="submit" variant="outline" size="sm" className="shrink-0">
							<Icon name="plus" size="sm" />
							<span className="hidden sm:inline">Add to Today</span>
							<span className="sm:hidden">Add</span>
						</Button>
					</Form>
				) : (
					<Button asChild variant="outline" size="sm" className="shrink-0">
						<Link to="/discover">
							<Icon name="magnifying-glass" size="sm" />
							Discover
						</Link>
					</Button>
				)}
			</div>
		</div>
	)
}
