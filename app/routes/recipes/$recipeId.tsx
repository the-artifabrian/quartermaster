import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Img } from 'openimg/react'
import { useState, useEffect, useCallback } from 'react'
import { Link, useFetcher, useSearchParams } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scaleAmount } from '#app/utils/fractions.ts'
import { cn } from '#app/utils/misc.tsx'
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
			isFavorite: true,
			sourceUrl: true,
			rawText: true,
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

export async function action({ request, params }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: { id: true, userId: true, isFavorite: true },
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.userId === userId, 'Not authorized', { status: 403 })

	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'toggleFavorite') {
		await prisma.recipe.update({
			where: { id: recipeId },
			data: { isFavorite: !recipe.isFavorite },
		})
		return { success: true }
	}

	return { success: false }
}

function useWakeLock() {
	const [isActive, setIsActive] = useState(false)

	const toggle = useCallback(() => {
		setIsActive((prev) => !prev)
	}, [])

	useEffect(() => {
		if (!isActive) return

		let wakeLock: WakeLockSentinel | null = null

		async function requestWakeLock() {
			try {
				if ('wakeLock' in navigator) {
					wakeLock = await navigator.wakeLock.request('screen')
				}
			} catch {
				// Wake Lock request failed (e.g., low battery)
			}
		}

		void requestWakeLock()

		function handleVisibilityChange() {
			if (document.visibilityState === 'visible') {
				void requestWakeLock()
			}
		}
		document.addEventListener('visibilitychange', handleVisibilityChange)

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			void wakeLock?.release()
		}
	}, [isActive])

	return { isActive, toggle }
}

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	const { recipe } = loaderData
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const [searchParams, setSearchParams] = useSearchParams()
	const favoriteFetcher = useFetcher()
	const isFavorite =
		favoriteFetcher.formData?.get('intent') === 'toggleFavorite'
			? !recipe.isFavorite
			: recipe.isFavorite
	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => new Set(),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(() => new Set())
	const wakeLock = useWakeLock()

	const servingsParam = searchParams.get('servings')
	const currentServings = servingsParam
		? Math.max(1, parseInt(servingsParam, 10) || recipe.servings)
		: recipe.servings
	const ratio = currentServings / recipe.servings
	const isScaled = currentServings !== recipe.servings

	function updateServings(newServings: number) {
		const clamped = Math.max(1, newServings)
		setSearchParams(
			(prev) => {
				if (clamped === recipe.servings) {
					prev.delete('servings')
				} else {
					prev.set('servings', clamped.toString())
				}
				return prev
			},
			{ replace: true },
		)
	}

	function toggleIngredient(id: string) {
		setCheckedIngredients((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	function toggleStep(id: string) {
		setCheckedSteps((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	return (
		<div className="container max-w-3xl py-6">
			{/* Header */}
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<Link
						to="/recipes"
						className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
					>
						<Icon name="arrow-left" size="sm" />
						Back to recipes
					</Link>
					<h1 className="text-3xl font-bold">{recipe.title}</h1>
				</div>
				<div className="flex gap-2">
					<favoriteFetcher.Form method="POST">
						<input type="hidden" name="intent" value="toggleFavorite" />
						<Button
							type="submit"
							variant="outline"
							title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
							className={isFavorite ? 'text-red-500 hover:text-red-600' : ''}
						>
							<Icon name={isFavorite ? 'heart-filled' : 'heart'} size="sm" />
						</Button>
					</favoriteFetcher.Form>
					<Button
						variant={wakeLock.isActive ? 'secondary' : 'outline'}
						onClick={wakeLock.toggle}
						title={
							wakeLock.isActive
								? 'Screen will stay on'
								: 'Keep screen on while cooking'
						}
					>
						<Icon name="clock" size="sm" />
						{wakeLock.isActive ? 'Screen On' : 'Keep Awake'}
					</Button>
					<Button asChild variant="outline">
						<Link to={`/recipes/${recipe.id}/edit`}>
							<Icon name="pencil-1" size="sm" />
							Edit
						</Link>
					</Button>
				</div>
			</div>

			{/* Image */}
			{recipe.image && (
				<div className="bg-muted mb-6 aspect-[16/9] overflow-hidden rounded-lg">
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
			<div className="text-muted-foreground mb-6 flex flex-wrap items-center gap-4 text-sm">
				{/* Servings with scaling controls */}
				<span className="flex items-center gap-1">
					<Icon name="avatar" size="sm" />
					<Button
						variant="outline"
						size="sm"
						className="h-7 w-7 p-0"
						onClick={() => updateServings(currentServings - 1)}
						disabled={currentServings <= 1}
					>
						-
					</Button>
					<span className="min-w-[5ch] text-center font-medium">
						{currentServings}
					</span>
					<Button
						variant="outline"
						size="sm"
						className="h-7 w-7 p-0"
						onClick={() => updateServings(currentServings + 1)}
					>
						+
					</Button>
					<span>servings</span>
					{isScaled && (
						<button
							onClick={() => updateServings(recipe.servings)}
							className="text-primary ml-1 text-xs hover:underline"
						>
							Reset
						</button>
					)}
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
					<span className="text-foreground font-medium">
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
							className="bg-secondary rounded-full px-3 py-1 text-sm"
						>
							{tag.name}
						</span>
					))}
				</div>
			)}

			{/* Source URL */}
			{recipe.sourceUrl && (
				<div className="mb-6">
					<a
						href={recipe.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline"
					>
						<Icon name="link-2" size="sm" />
						{(() => {
							try {
								return new URL(recipe.sourceUrl).hostname.replace(/^www\./, '')
							} catch {
								return recipe.sourceUrl
							}
						})()}
					</a>
				</div>
			)}

			{/* Description */}
			{recipe.description && (
				<p className="text-muted-foreground mb-8 text-lg">
					{recipe.description}
				</p>
			)}

			{/* Raw Text (quick-entry recipes) */}
			{recipe.rawText && (
				<div className="mb-8">
					<h2 className="mb-4 text-xl font-semibold">Recipe Notes</h2>
					<div className="bg-muted/50 rounded-lg p-4">
						<pre className="font-sans text-sm whitespace-pre-wrap">
							{recipe.rawText}
						</pre>
					</div>
				</div>
			)}

			<div className="grid gap-8 md:grid-cols-[1fr_2fr]">
				{/* Ingredients */}
				<div>
					<h2 className="mb-4 text-xl font-semibold">Ingredients</h2>
					<ul className="space-y-2">
						{recipe.ingredients.map((ingredient) => {
							const isChecked = checkedIngredients.has(ingredient.id)
							return (
								<li
									key={ingredient.id}
									className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 transition-colors select-none"
									onClick={() => toggleIngredient(ingredient.id)}
								>
									<span
										className={cn(
											'mt-2 block size-1.5 shrink-0 rounded-full',
											isChecked ? 'bg-muted-foreground/30' : 'bg-primary',
										)}
									/>
									<span
										className={cn(
											'transition-colors',
											isChecked && 'text-muted-foreground/50 line-through',
										)}
									>
										{ingredient.amount && (
											<span className="font-medium">
												{scaleAmount(ingredient.amount, ratio)}{' '}
											</span>
										)}
										{ingredient.unit && <span>{ingredient.unit} </span>}
										<span>{ingredient.name}</span>
										{ingredient.notes && (
											<span
												className={isChecked ? '' : 'text-muted-foreground'}
											>
												, {ingredient.notes}
											</span>
										)}
									</span>
								</li>
							)
						})}
					</ul>
				</div>

				{/* Instructions */}
				<div>
					<h2 className="mb-4 text-xl font-semibold">Instructions</h2>
					<ol className="space-y-4">
						{recipe.instructions.map((instruction, index) => {
							const isChecked = checkedSteps.has(instruction.id)
							return (
								<li
									key={instruction.id}
									className="hover:bg-muted/50 flex cursor-pointer gap-4 rounded-md px-2 py-1 transition-colors select-none"
									onClick={() => toggleStep(instruction.id)}
								>
									<span
										className={cn(
											'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors',
											isChecked
												? 'bg-muted text-muted-foreground/50'
												: 'bg-primary text-primary-foreground',
										)}
									>
										{isChecked ? <Icon name="check" size="sm" /> : index + 1}
									</span>
									<p
										className={cn(
											'pt-1 transition-colors',
											isChecked && 'text-muted-foreground/50 line-through',
										)}
									>
										{instruction.content}
									</p>
								</li>
							)
						})}
					</ol>
				</div>
			</div>
		</div>
	)
}
