import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeCardProps = {
	id: string
	title: string
	description?: string | null
	imageObjectKey?: string | null
	prepTime?: number | null
	cookTime?: number | null
	tags?: Array<{ id: string; name: string }>
}

export function RecipeCard({
	id,
	title,
	description,
	imageObjectKey,
	prepTime,
	cookTime,
	tags,
}: RecipeCardProps) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${id}`}
			className="group block rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md"
		>
			<div className="aspect-[4/3] overflow-hidden rounded-t-lg bg-muted">
				{imageObjectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(imageObjectKey)}`}
						alt={title}
						className="h-full w-full object-cover transition-transform group-hover:scale-105"
						width={400}
						height={300}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						<Icon name="cookie" className="size-12 text-muted-foreground" />
					</div>
				)}
			</div>
			<div className="p-4">
				<h3 className="font-semibold line-clamp-1 group-hover:text-primary">
					{title}
				</h3>
				{description && (
					<p className="mt-1 text-sm text-muted-foreground line-clamp-2">
						{description}
					</p>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{totalTime > 0 && (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{tags && tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{tags.slice(0, 2).map((tag) => (
								<span
									key={tag.id}
									className="rounded-full bg-secondary px-2 py-0.5 text-xs"
								>
									{tag.name}
								</span>
							))}
							{tags.length > 2 && (
								<span className="text-xs text-muted-foreground">
									+{tags.length - 2}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</Link>
	)
}

export function RecipeCardGrid({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return (
		<div
			className={cn(
				'grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
				className,
			)}
		>
			{children}
		</div>
	)
}
