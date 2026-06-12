import { Img } from 'openimg/react'
import { Link } from 'react-router'
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

export function TodayBanner({ entries }: { entries: TodayEntry[] }) {
	if (entries.length === 0) return null
	const primary = entries[0]!
	const recipe = primary.recipe
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const mealLabel =
		MEAL_TYPE_LABELS[primary.mealType as MealType] ?? primary.mealType
	const remaining = entries.length - 1

	return (
		<div className="border-accent/40 from-background to-secondary dark:from-card dark:to-secondary/20 mb-4 overflow-hidden rounded-md border-l-[3px] bg-linear-to-r">
			<div className="flex items-center gap-3.5 p-4 sm:gap-5 sm:p-5">
				{/* Recipe image */}
				<div className="bg-muted size-14 shrink-0 overflow-hidden rounded-lg sm:size-16">
					{recipe.image?.objectKey ? (
						<Img
							src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
							alt={recipe.title}
							className="h-full w-full object-cover"
							width={128}
							height={128}
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
					{/* Copper marks the banner's left edge; the label itself stays stone
					    (copper text at 12px fails AA on cream) */}
					<p className="text-muted-foreground text-xs font-medium tracking-wide">
						Up next &middot; {mealLabel}
					</p>
					<h3 className="line-clamp-2 font-serif text-lg leading-snug">
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
