import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { type Route } from './+types/$recipeId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: {
			id: true,
			title: true,
			description: true,
			servings: true,
			prepTime: true,
			cookTime: true,
			userId: true,
			image: { select: { objectKey: true, altText: true } },
			ingredients: {
				select: {
					id: true,
					name: true,
					amount: true,
					unit: true,
					notes: true,
				},
				orderBy: { order: 'asc' },
			},
			instructions: {
				select: {
					id: true,
					content: true,
				},
				orderBy: { order: 'asc' },
			},
			tags: {
				select: { id: true, name: true, category: true },
			},
		},
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.userId === userId, 'Not authorized', { status: 403 })

	return { recipe }
}

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	const { recipe } = loaderData
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	return (
		<div className="container max-w-3xl py-6">
			{/* Header */}
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<Link
						to="/recipes"
						className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					>
						<Icon name="arrow-left" size="sm" />
						Back to recipes
					</Link>
					<h1 className="text-3xl font-bold">{recipe.title}</h1>
				</div>
				<Button asChild variant="outline">
					<Link to={`/recipes/${recipe.id}/edit`}>
						<Icon name="pencil-1" size="sm" />
						Edit
					</Link>
				</Button>
			</div>

			{/* Image */}
			{recipe.image && (
				<div className="mb-6 aspect-[16/9] overflow-hidden rounded-lg bg-muted">
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
						alt={recipe.image.altText ?? recipe.title}
						className="h-full w-full object-cover"
						width={800}
						height={450}
						isAboveFold
					/>
				</div>
			)}

			{/* Meta info */}
			<div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
				<span className="flex items-center gap-1">
					<Icon name="avatar" size="sm" />
					{recipe.servings} servings
				</span>
				{recipe.prepTime && (
					<span className="flex items-center gap-1">
						<Icon name="clock" size="sm" />
						Prep: {recipe.prepTime} min
					</span>
				)}
				{recipe.cookTime && (
					<span className="flex items-center gap-1">
						<Icon name="clock" size="sm" />
						Cook: {recipe.cookTime} min
					</span>
				)}
				{totalTime > 0 && (
					<span className="font-medium text-foreground">
						Total: {totalTime} min
					</span>
				)}
			</div>

			{/* Tags */}
			{recipe.tags.length > 0 && (
				<div className="mb-6 flex flex-wrap gap-2">
					{recipe.tags.map((tag) => (
						<span
							key={tag.id}
							className="rounded-full bg-secondary px-3 py-1 text-sm"
						>
							{tag.name}
						</span>
					))}
				</div>
			)}

			{/* Description */}
			{recipe.description && (
				<p className="mb-8 text-lg text-muted-foreground">
					{recipe.description}
				</p>
			)}

			<div className="grid gap-8 md:grid-cols-[1fr_2fr]">
				{/* Ingredients */}
				<div>
					<h2 className="mb-4 text-xl font-semibold">Ingredients</h2>
					<ul className="space-y-2">
						{recipe.ingredients.map((ingredient) => (
							<li key={ingredient.id} className="flex items-start gap-2">
								<span className="mt-2 block size-1.5 rounded-full bg-primary" />
								<span>
									{ingredient.amount && (
										<span className="font-medium">{ingredient.amount} </span>
									)}
									{ingredient.unit && <span>{ingredient.unit} </span>}
									<span>{ingredient.name}</span>
									{ingredient.notes && (
										<span className="text-muted-foreground">
											, {ingredient.notes}
										</span>
									)}
								</span>
							</li>
						))}
					</ul>
				</div>

				{/* Instructions */}
				<div>
					<h2 className="mb-4 text-xl font-semibold">Instructions</h2>
					<ol className="space-y-4">
						{recipe.instructions.map((instruction, index) => (
							<li key={instruction.id} className="flex gap-4">
								<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
									{index + 1}
								</span>
								<p className="pt-1">{instruction.content}</p>
							</li>
						))}
					</ol>
				</div>
			</div>
		</div>
	)
}
