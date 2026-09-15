import { Link } from 'react-router'
import { RecipeThumb } from '#app/components/recipe-selector.tsx'
import { Icon } from './ui/icon.tsx'

type MenuCardProps = {
	id: string
	title: string
	description?: string | null
	defaultGuestCount?: number | null
	recipeCount?: number
	recipes?: Array<{ title: string; image: { objectKey: string } | null }>
}

export function MenuCard({
	id,
	title,
	description,
	defaultGuestCount,
	recipeCount = 0,
	recipes = [],
}: MenuCardProps) {
	const meta = [
		recipeCount > 0
			? `${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'}`
			: null,
		defaultGuestCount ? `${defaultGuestCount} guests` : null,
	].filter(Boolean)
	return (
		<Link
			to={`/recipes/menus/${id}`}
			viewTransition
			className="group active:bg-muted/40 md:border-border/60 md:bg-card md:text-card-foreground md:hover:border-accent/30 md:active:bg-card flex flex-row items-center gap-3.5 px-4 py-3 transition-colors sm:px-8 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-md md:border md:p-0 md:transition-all md:duration-[180ms] md:ease-[var(--ease-hover-lift)]"
		>
			{/* Menus carry no imagery of their own (Gate 1A dogfood); the row
			    borrows a small stack of its Recipes' thumbs instead. */}
			{recipes.length > 0 ? (
				<span className="flex shrink-0 -space-x-3 md:hidden">
					{recipes.map((recipe, index) => (
						<RecipeThumb
							key={index}
							title={recipe.title}
							image={recipe.image}
							className="ring-background size-10 rounded-full ring-2"
						/>
					))}
				</span>
			) : null}

			{/* Content */}
			<div className="flex min-w-0 flex-1 flex-col justify-center md:justify-start md:p-6">
				<h3 className="min-w-0 font-serif text-[17px] leading-[1.4] md:text-base md:leading-[1.3] md:tracking-[-0.005em]">
					<span className="line-clamp-2">{title}</span>
				</h3>

				{/* Mobile meta: one description line, then the counts. */}
				{description ? (
					<span className="text-muted-foreground mt-0.5 line-clamp-1 text-[13px] md:hidden">
						{description}
					</span>
				) : null}
				{meta.length > 0 ? (
					<span className="text-muted-foreground/80 mt-1 text-xs md:hidden">
						{meta.join(' · ')}
					</span>
				) : null}

				{/* Description — desktop only */}
				{description && (
					<p className="text-muted-foreground hidden md:mt-1 md:line-clamp-3 md:block md:text-sm">
						{description}
					</p>
				)}

				{/* Desktop meta */}
				{defaultGuestCount ? (
					<div className="mt-auto hidden items-center gap-3 pt-2 md:flex">
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<Icon name="avatar" size="xs" />
							{defaultGuestCount} guests
						</span>
					</div>
				) : null}
			</div>
		</Link>
	)
}
