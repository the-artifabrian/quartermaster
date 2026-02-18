import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Img } from 'openimg/react'
import { useState } from 'react'
import {
	Link,
	redirect,
	useFetcher,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'
import { InstructionWithTimers } from '#app/components/instruction-with-timers.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scaleAmount } from '#app/utils/fractions.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipeJsonLd } from '#app/utils/recipe-detail.ts'
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

export async function loader({ params, request }: Route.LoaderArgs) {
	const { recipeId } = params
	const userId = await getUserId(request)

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: {
			id: true,
			title: true,
			description: true,
			servings: true,
			prepTime: true,
			cookTime: true,
			isAiGenerated: true,
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
			},
	})

	if (!recipe) {
		throw new Response('Recipe not found', { status: 404 })
	}

	let alreadySaved = false
	if (userId) {
		const member = await prisma.householdMember.findFirst({
			where: { userId },
			select: { householdId: true },
		})
		if (member) {
			const existing = await prisma.recipe.findFirst({
				where: { householdId: member.householdId, title: recipe.title },
				select: { id: true },
			})
			alreadySaved = Boolean(existing)
		}
	}

	return { recipe, isLoggedIn: Boolean(userId), alreadySaved }
}

export async function action({ params, request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		include: {
			ingredients: true,
			instructions: true,
			image: true,
		},
	})

	if (!recipe) {
		throw new Response('Recipe not found', { status: 404 })
	}

	// Prevent duplicates from double-clicks or resubmits
	const existing = await prisma.recipe.findFirst({
		where: { householdId, title: recipe.title },
		select: { id: true },
	})
	if (existing) {
		return redirect(`/recipes/${existing.id}`)
	}

	const newRecipe = await prisma.recipe.create({
		data: {
			title: recipe.title,
			description: recipe.description,
			servings: recipe.servings,
			prepTime: recipe.prepTime,
			cookTime: recipe.cookTime,
			isFavorite: false,
			isAiGenerated: recipe.isAiGenerated,
			sourceUrl: recipe.sourceUrl,
			rawText: recipe.rawText,
			userId,
			householdId,
			ingredients: {
				create: recipe.ingredients.map((ing) => ({
					name: ing.name,
					amount: ing.amount,
					unit: ing.unit,
					notes: ing.notes,
					isHeading: ing.isHeading,
					order: ing.order,
				})),
			},
			instructions: {
				create: recipe.instructions.map((inst) => ({
					content: inst.content,
					order: inst.order,
				})),
			},
			...(recipe.image
				? {
						image: {
							create: {
								altText: recipe.image.altText,
								objectKey: recipe.image.objectKey,
							},
						},
					}
				: {}),
		},
		select: { id: true },
	})

	void emitHouseholdEvent({
		householdId,
		userId,
		type: 'recipe_created',
		payload: { recipeId: newRecipe.id, recipeTitle: recipe.title },
	})

	return redirect(`/recipes/${newRecipe.id}`)
}

// --- Main component ---

export default function SharedRecipeView({ loaderData }: Route.ComponentProps) {
	const { recipe, isLoggedIn, alreadySaved } = loaderData
	const saveFetcher = useFetcher()
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
				{recipe.isAiGenerated && (
					<span className="mt-2 inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
						<Icon name="sparkles" className="size-3" />
						AI Generated
					</span>
				)}
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
				{(recipe.prepTime ||
					recipe.cookTime ||
					recipe.sourceUrl) && (
					<div className="bg-card shadow-warm-lg mt-4 rounded-2xl border p-3 md:p-5">
						<div className="flex flex-wrap items-center gap-3 text-sm">
							{recipe.prepTime && (
								<span className="text-muted-foreground flex items-center gap-1">
									<Icon name="clock" size="sm" className="text-accent" />
									Prep: {recipe.prepTime} min
								</span>
							)}
							{recipe.cookTime && (
								<>
									{recipe.prepTime && (
										<span className="text-border hidden md:inline">|</span>
									)}
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
									{(recipe.prepTime || recipe.cookTime) && (
										<span className="text-border hidden md:inline">|</span>
									)}
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
					</div>
				)}

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
								<span className="ml-auto flex items-center gap-1">
									<Button
										variant="outline"
										size="sm"
										className="h-8 w-8 p-0 text-xs"
										onClick={() => updateServings(currentServings - 1)}
										disabled={currentServings <= 1}
									>
										-
									</Button>
									<span className="min-w-[3ch] text-center text-sm font-medium">
										{currentServings}
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-8 w-8 p-0 text-xs"
										onClick={() => updateServings(currentServings + 1)}
									>
										+
									</Button>
									{isScaled ? (
										<button
											onClick={() => updateServings(recipe.servings)}
											className="text-primary text-xs hover:underline"
										>
											Reset
										</button>
									) : (
										<span className="text-muted-foreground text-sm">
											servings
										</span>
									)}
								</span>
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
												{isChecked && <Icon name="check" className="size-3" />}
											</span>
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
											{isChecked ? <Icon name="check" size="sm" /> : index + 1}
										</span>
										<p
											className={cn(
												'pt-1 text-base transition-colors',
												isChecked && 'text-muted-foreground/50 line-through',
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

				{/* Save / Sign-up CTA */}
				<div className="mt-12 mb-8 text-center">
					<div className="bg-accent/5 inline-block rounded-2xl border px-8 py-6">
						{isLoggedIn ? (
							<>
								<p className="text-lg font-semibold">Like this recipe?</p>
								<p className="text-muted-foreground mt-1 text-sm">
									Save it to your recipes to cook later, add to meal plans, and
									more.
								</p>
								<div className="mt-4 flex justify-center">
									{alreadySaved ? (
										<Button disabled variant="outline">
											<Icon name="check">Already saved</Icon>
										</Button>
									) : (
										<saveFetcher.Form method="POST">
											<Button
												type="submit"
												disabled={saveFetcher.state !== 'idle'}
											>
												<Icon name="plus">Save to My Recipes</Icon>
											</Button>
										</saveFetcher.Form>
									)}
								</div>
							</>
						) : (
							<>
								<p className="text-lg font-semibold">Like this recipe?</p>
								<p className="text-muted-foreground mt-1 text-sm">
									Sign up for Quartermaster to save recipes, plan meals, and
									track your pantry.
								</p>
								<div className="mt-4 flex justify-center gap-3">
									<Button asChild>
										<Link to="/signup">Sign up free</Link>
									</Button>
									<Button asChild variant="outline">
										<Link to="/login">Log in</Link>
									</Button>
								</div>
							</>
						)}
					</div>
				</div>
			</div>
		</>
	)
}
