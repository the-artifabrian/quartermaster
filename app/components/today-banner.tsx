import { Img } from 'openimg/react'
import { Form, Link } from 'react-router'
import { MEAL_TYPE_LABELS, type MealType } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type TodayEntry = {
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

type TodaySuggestion = {
	id: string
	title: string
	image: { objectKey: string } | null
}

type TodayBannerProps = {
	entries: TodayEntry[]
	suggestion: TodaySuggestion | null
	dismissed?: boolean
	onDismiss?: () => void
}

export function TodayBanner({
	entries,
	suggestion,
	dismissed,
	onDismiss,
}: TodayBannerProps) {
	if (entries.length > 0) {
		return <HasMealsBanner entries={entries} />
	}

	if (dismissed) return null

	return <EmptyBanner suggestion={suggestion} onDismiss={onDismiss} />
}

function HasMealsBanner({ entries }: { entries: TodayEntry[] }) {
	const primary = entries[0]!
	const recipe = primary.recipe
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const mealLabel =
		MEAL_TYPE_LABELS[primary.mealType as MealType] ?? primary.mealType
	const remaining = entries.length - 1

	return (
		<div className="shadow-warm mb-4 overflow-hidden rounded-2xl bg-linear-to-r from-background to-secondary dark:from-card dark:to-secondary/20">
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
											'font-serif text-2xl',
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
					<p className="text-accent text-xs font-medium tracking-wide">
						Up next &middot; {mealLabel}
					</p>
					<h3 className="font-serif truncate text-lg">
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
							<span>{primary.servings ?? recipe.servings} servings</span>
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
					<Link
						to={
							primary.servings && primary.servings !== recipe.servings
								? `/recipes/${recipe.id}?servings=${primary.servings}`
								: `/recipes/${recipe.id}`
						}
					>
						<Icon name="file-text" size="sm" />
						<span className="hidden sm:inline">Let's cook</span>
						<span className="sm:hidden">Cook</span>
					</Link>
				</Button>
			</div>
		</div>
	)
}

function EmptyBanner({
	suggestion,
	onDismiss,
}: {
	suggestion: TodaySuggestion | null
	onDismiss?: () => void
}) {
	const now = new Date()
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

	return (
		<div className="shadow-warm mb-4 overflow-hidden rounded-2xl bg-linear-to-r from-background to-secondary dark:from-card dark:to-secondary/20">
			<div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
				<div className="min-w-0 flex-1">
					<p className="font-serif text-sm">
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
							Browse your recipes and pick something to make.
						</p>
					)}
				</div>

				{suggestion ? (
					<Form method="POST">
						<input type="hidden" name="intent" value="assign" />
						<input type="hidden" name="date" value={today} />
						<input type="hidden" name="mealType" value="dinner" />
						<input type="hidden" name="recipeId" value={suggestion.id} />
						<Button
							type="submit"
							variant="outline"
							size="sm"
							className="shrink-0"
						>
							<Icon name="plus" size="sm" />
							<span className="hidden sm:inline">Add to Today</span>
							<span className="sm:hidden">Add</span>
						</Button>
					</Form>
				) : (
					<Button asChild variant="outline" size="sm" className="shrink-0">
						<Link to="/recipes">
							<Icon name="magnifying-glass" size="sm" />
							Browse
						</Link>
					</Button>
				)}
				{onDismiss && (
					<button
						type="button"
						onClick={onDismiss}
						className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground"
						aria-label="Dismiss"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				)}
			</div>
		</div>
	)
}
