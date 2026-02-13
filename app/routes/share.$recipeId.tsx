import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Img } from 'openimg/react'
import { useState } from 'react'
import { Link, useRouteLoaderData, useSearchParams } from 'react-router'
import { InstructionWithTimers } from '#app/components/instruction-with-timers.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { scaleAmount } from '#app/utils/fractions.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/share.$recipeId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ data, matches }) => {
	const recipe = data?.recipe
	const title = recipe?.title
		? `${recipe.title} | Quartermaster`
		: 'Recipe | Quartermaster'
	const description =
		recipe?.description || `View recipe for ${recipe?.title ?? 'a dish'}`

	const rootMatch = matches.find((m) => m?.id === 'root')
	const origin = (
		rootMatch?.data as { requestInfo?: { origin?: string } } | undefined
	)?.requestInfo?.origin

	const meta: ReturnType<Route.MetaFunction> = [
		{ title },
		{ name: 'description', content: description },
		{ property: 'og:title', content: title },
		{ property: 'og:description', content: description },
		{ property: 'og:type', content: 'article' },
		{ property: 'og:site_name', content: 'Quartermaster' },
	]

	if (origin && recipe) {
		meta.push({
			property: 'og:url',
			content: `${origin}/share/${recipe.id}`,
		})
	}

	if (origin && recipe?.image?.objectKey) {
		const imageUrl = `${origin}/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=1200&h=630&fit=cover`
		meta.push(
			{ property: 'og:image', content: imageUrl },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:image', content: imageUrl },
		)
	} else {
		meta.push({ name: 'twitter:card', content: 'summary' })
	}

	meta.push(
		{ name: 'twitter:title', content: title },
		{ name: 'twitter:description', content: description },
	)

	return meta
}

export async function loader({ params }: Route.LoaderArgs) {
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
			sourceUrl: true,
			user: { select: { name: true } },
			image: { select: { objectKey: true, altText: true } },
			ingredients: {
				select: {
					id: true,
					name: true,
					amount: true,
					unit: true,
					notes: true,
					isHeading: true,
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

	if (!recipe) {
		throw new Response('Recipe not found', { status: 404 })
	}

	return { recipe }
}

// --- Utility functions ---

function toIsoDuration(minutes: number | null | undefined): string | undefined {
	if (!minutes) return undefined
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`
}

function getRecipeJsonLd(
	recipe: {
		title: string
		description: string | null
		servings: number
		prepTime: number | null
		cookTime: number | null
		image: { objectKey: string; altText: string | null } | null
		ingredients: Array<{
			name: string
			amount: string | null
			unit: string | null
			isHeading?: boolean
		}>
		instructions: Array<{ content: string }>
		tags: Array<{ name: string; category: string }>
	},
	origin: string | undefined,
) {
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	const jsonLd: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': 'Recipe',
		name: recipe.title,
		...(recipe.description && { description: recipe.description }),
		...(recipe.servings && { recipeYield: `${recipe.servings} servings` }),
		...(recipe.prepTime && { prepTime: toIsoDuration(recipe.prepTime) }),
		...(recipe.cookTime && { cookTime: toIsoDuration(recipe.cookTime) }),
		...(totalTime > 0 && { totalTime: toIsoDuration(totalTime) }),
		recipeIngredient: recipe.ingredients
			.filter((i) => !i.isHeading)
			.map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(' ')),
		recipeInstructions: recipe.instructions.map((step, idx) => ({
			'@type': 'HowToStep',
			position: idx + 1,
			text: step.content,
		})),
	}

	const mealTypes = recipe.tags
		.filter((t) => t.category === 'meal-type')
		.map((t) => t.name)
	if (mealTypes.length > 0) jsonLd.recipeCategory = mealTypes

	const cuisines = recipe.tags
		.filter((t) => t.category === 'cuisine')
		.map((t) => t.name)
	if (cuisines.length > 0) jsonLd.recipeCuisine = cuisines

	if (origin && recipe.image?.objectKey) {
		jsonLd.image = `${origin}/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=1200&h=630&fit=cover`
	}

	return jsonLd
}

// --- Main component ---

export default function SharedRecipeView({ loaderData }: Route.ComponentProps) {
	const { recipe } = loaderData
	const rootData = useRouteLoaderData('root') as
		| { requestInfo?: { origin?: string } }
		| undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	const [searchParams, setSearchParams] = useSearchParams()
	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => new Set(),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(() => new Set())

	const servingsParam = searchParams.get('servings')
	const currentServings = servingsParam
		? Math.min(999, Math.max(1, parseInt(servingsParam, 10) || recipe.servings))
		: recipe.servings
	const ratio = currentServings / recipe.servings
	const isScaled = currentServings !== recipe.servings

	function updateServings(newServings: number) {
		const clamped = Math.min(999, Math.max(1, newServings))
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
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(recipeJsonLd).replace(/</g, '\\u003c'),
				}}
			/>

			{/* Header */}
			<div className="container max-w-4xl px-4 pt-4 md:px-8 md:pt-6">
				<p className="text-muted-foreground mb-2 text-sm">
					Shared{recipe.user.name ? ` by ${recipe.user.name}` : ''} on{' '}
					<Link to="/" className="text-primary hover:underline">
						Quartermaster
					</Link>
				</p>
				<h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl">
					{recipe.title}
				</h1>
			</div>

			{/* Hero image */}
			{recipe.image && (
				<div className="container max-w-4xl px-4 md:px-8">
					<div className="mt-4 overflow-hidden rounded-2xl">
						<Img
							src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
							alt={recipe.image.altText ?? recipe.title}
							className="aspect-[2/1] w-full object-cover"
							width={1200}
							height={600}
						/>
					</div>
				</div>
			)}

			{/* Meta card + content */}
			<div className="container max-w-4xl px-4 md:px-8">
				<div className="bg-card shadow-warm-lg mt-4 rounded-2xl border p-3 md:p-5">
					<div className="flex flex-wrap items-center gap-3 text-sm">
						{/* Servings */}
						<span className="flex items-center gap-1">
							<Icon name="avatar" size="sm" className="text-accent" />
							<Button
								variant="outline"
								size="sm"
								className="h-7 w-7 p-0 md:h-9 md:w-9"
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
								className="h-7 w-7 p-0 md:h-9 md:w-9"
								onClick={() => updateServings(currentServings + 1)}
							>
								+
							</Button>
							<span className="text-muted-foreground">servings</span>
							{isScaled && (
								<button
									onClick={() => updateServings(recipe.servings)}
									className="text-primary ml-1 text-xs hover:underline"
								>
									Reset
								</button>
							)}
						</span>

						{(recipe.prepTime || recipe.cookTime) && (
							<span className="text-border hidden md:inline">|</span>
						)}

						{recipe.prepTime && (
							<span className="text-muted-foreground flex items-center gap-1">
								<Icon name="clock" size="sm" className="text-accent" />
								Prep: {recipe.prepTime} min
							</span>
						)}
						{recipe.cookTime && (
							<>
								<span className="text-border hidden md:inline">|</span>
								<span className="text-muted-foreground flex items-center gap-1">
									<Icon name="clock" size="sm" className="text-accent" />
									Cook: {recipe.cookTime} min
								</span>
							</>
						)}
						{totalTime > 0 && (
							<>
								<span className="text-border hidden md:inline">|</span>
								<span className="text-foreground font-medium">
									Total: {totalTime} min
								</span>
							</>
						)}

						{/* Source URL inline */}
						{recipe.sourceUrl && (
							<>
								<span className="text-border hidden md:inline">|</span>
								<a
									href={recipe.sourceUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline"
								>
									<Icon name="link-2" size="sm" />
									{(() => {
										try {
											return new URL(recipe.sourceUrl).hostname.replace(
												/^www\./,
												'',
											)
										} catch {
											return 'Source'
										}
									})()}
								</a>
							</>
						)}
					</div>

					{/* Tags inside meta card */}
					{recipe.tags.length > 0 && (
						<div className="mt-3 flex flex-wrap gap-1.5">
							{recipe.tags.map((tag) => (
								<span
									key={tag.id}
									className="bg-accent/10 border-accent/20 rounded-full border px-2.5 py-0.5 text-xs font-medium"
								>
									{tag.name}
								</span>
							))}
						</div>
					)}
				</div>

				{/* Description */}
				{recipe.description && (
					<p className="text-muted-foreground mt-6 text-lg">
						{recipe.description}
					</p>
				)}

				{/* Content zone: Ingredients + Instructions */}
				<div className="mt-5 grid gap-5 md:mt-8 md:grid-cols-[2fr_3fr] md:gap-8">
					{/* Ingredients */}
					<div className="md:sticky md:top-20 md:self-start">
						<div className="bg-card shadow-warm rounded-2xl border p-4 md:p-6">
							<div className="mb-3 flex items-center gap-2 md:mb-4">
								<h2 className="text-lg font-semibold">Ingredients</h2>
								{isScaled && (
									<span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
										Scaled
									</span>
								)}
							</div>
							<ul className="space-y-1">
								{recipe.ingredients.map((ingredient) => {
									if (ingredient.isHeading) {
										return (
											<li key={ingredient.id}>
												<p className="text-muted-foreground mt-3 mb-1 px-2 text-sm font-semibold tracking-wide first:mt-0">
													{ingredient.name}
												</p>
											</li>
										)
									}

									const isChecked = checkedIngredients.has(ingredient.id)
									return (
										<li
											key={ingredient.id}
											role="checkbox"
											aria-checked={isChecked}
											tabIndex={0}
											className="hover:bg-accent/5 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors select-none"
											onClick={() => toggleIngredient(ingredient.id)}
											onKeyDown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault()
													toggleIngredient(ingredient.id)
												}
											}}
										>
											<span
												className={cn(
													'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
													isChecked
														? 'border-primary bg-primary text-primary-foreground'
														: 'border-muted-foreground/25',
												)}
											>
												{isChecked && (
													<Icon name="check" className="size-3" />
												)}
											</span>
											<span
												className={cn(
													'transition-colors',
													isChecked &&
														'text-muted-foreground/50 line-through',
												)}
											>
												{ingredient.amount && (
													<span className="font-medium">
														{scaleAmount(ingredient.amount, ratio)}{' '}
													</span>
												)}
												{ingredient.unit && (
													<span>{ingredient.unit} </span>
												)}
												<span>{ingredient.name}</span>
												{ingredient.notes && (
													<span
														className={
															isChecked ? '' : 'text-muted-foreground'
														}
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
					</div>

					{/* Instructions */}
					<div>
						<h2 className="mb-4 text-lg font-semibold">Instructions</h2>
						<ol className="space-y-4">
							{recipe.instructions.map((instruction, index) => {
								const isChecked = checkedSteps.has(instruction.id)
								return (
									<li
										key={instruction.id}
										role="checkbox"
										aria-checked={isChecked}
										tabIndex={0}
										className={cn(
											'flex cursor-pointer gap-4 rounded-lg px-2 py-2 transition-all select-none',
											'hover:bg-muted/50',
										)}
										onClick={() => toggleStep(instruction.id)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault()
												toggleStep(instruction.id)
											}
										}}
									>
										<span
											className={cn(
												'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors',
												isChecked
													? 'bg-primary/20 text-primary'
													: 'bg-accent/10 text-accent border-accent/20 border',
											)}
										>
											{isChecked ? (
												<Icon name="check" size="sm" />
											) : (
												index + 1
											)}
										</span>
										<p
											className={cn(
												'pt-1 text-base transition-colors',
												isChecked &&
													'text-muted-foreground/50 line-through',
											)}
										>
											<InstructionWithTimers
												content={instruction.content}
												stepNumber={index + 1}
												recipeName={recipe.title}
											/>
										</p>
									</li>
								)
							})}
						</ol>
					</div>
				</div>

				{/* Sign-up CTA */}
				<div className="mt-12 mb-8 text-center">
					<div className="bg-accent/5 inline-block rounded-2xl border px-8 py-6">
						<p className="text-lg font-semibold">Like this recipe?</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Sign up for Quartermaster to save recipes, plan meals, and track
							your pantry.
						</p>
						<div className="mt-4 flex justify-center gap-3">
							<Button asChild>
								<Link to="/signup">Sign up free</Link>
							</Button>
							<Button asChild variant="outline">
								<Link to="/login">Log in</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</>
	)
}
