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
import { Divider } from '#app/components/divider.tsx'
import { IngredientList } from '#app/components/recipe-ingredient-list.tsx'
import { RecipeInstructionsList } from '#app/components/recipe-instructions-list.tsx'
import { RecipeMetadataCard } from '#app/components/recipe-metadata-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	type AppliedSubstitution,
	getRecipeJsonLd,
} from '#app/utils/recipe-detail.ts'
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

	return redirect(`/recipes/${newRecipe.id}`)
}

// --- Main component ---

const noSubstitutions = new Map<string, AppliedSubstitution>()
function noop() {}

export default function SharedRecipeView({ loaderData }: Route.ComponentProps) {
	const { recipe, isLoggedIn, alreadySaved } = loaderData
	const saveFetcher = useFetcher()
	const rootData = useRouteLoaderData('root') as
		| { requestInfo?: { origin?: string } }
		| undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const [searchParams, setSearchParams] = useSearchParams()
	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => new Set(),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(() => new Set())
	const [ingredientsExpanded, setIngredientsExpanded] = useState(true)

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

			<div className="container-content pt-4 pb-20 md:pt-6 md:pb-6">
				<p className="text-muted-foreground mb-2 text-sm">
					Shared{recipe.user.name ? ` by ${recipe.user.name}` : ''} on{' '}
					<Link to="/" className="text-primary hover:underline">
						Quartermaster
					</Link>
				</p>

				{/* Title + Image layout */}
				<div className="flex flex-col md:flex-row md:items-start md:gap-8">
					<div className="min-w-0 flex-1">
						<h1 className="font-serif text-[2rem] leading-[1.15] font-normal tracking-[-0.02em]">
							{recipe.title}
						</h1>
						<Divider className="mt-3 mb-2 max-w-xs" />
						<RecipeMetadataCard
							prepTime={recipe.prepTime}
							cookTime={recipe.cookTime}
							sourceUrl={recipe.sourceUrl}
						/>
					</div>

					{/* Image beside title on desktop, below on mobile */}
					{recipe.image && (
						<div className="mt-4 shrink-0 md:mt-0 md:w-[400px]">
							<Img
								src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
								alt={recipe.image.altText ?? recipe.title}
								className="border-border w-full rounded-md border object-cover md:aspect-[4/3]"
								width={800}
								height={600}
							/>
						</div>
					)}
				</div>
				{/* Description */}
				{recipe.description && (
					<p className="text-muted-foreground mt-5 text-base leading-relaxed">
						{recipe.description}
					</p>
				)}

				{/* Content zone: Ingredients + Instructions */}
				<div className="mt-4 grid gap-5 md:mt-8 md:grid-cols-[5fr_7fr] md:gap-8">
					{/* Ingredients */}
					<div className="md:sticky md:top-20 md:self-start">
						<div className="bg-card shadow-warm rounded-2xl border p-4 md:p-6">
							<div className="mb-3 flex items-center gap-2 md:mb-4">
								<button
									type="button"
									className="flex items-center gap-1.5 md:pointer-events-none"
									onClick={() => setIngredientsExpanded((v) => !v)}
									aria-expanded={ingredientsExpanded}
									aria-controls="ingredients-list"
								>
									<Icon
										name="chevron-down"
										size="sm"
										className={cn(
											'text-muted-foreground transition-transform md:hidden',
											!ingredientsExpanded && '-rotate-90',
										)}
									/>
									<h2 className="font-serif text-lg font-normal">
										Ingredients
									</h2>
								</button>
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
							<div
								id="ingredients-list"
								className={cn(!ingredientsExpanded && 'hidden md:block')}
							>
								<IngredientList
									ingredients={recipe.ingredients}
									checkedIngredients={checkedIngredients}
									onToggle={toggleIngredient}
									ratio={ratio}
									missingIngredientIds={[]}
									isProActive={false}
									recipeId={recipe.id}
									substitutions={noSubstitutions}
									onApplySubstitution={noop}
									onRevertSubstitution={noop}
									shoppingFetcher={saveFetcher}
									showFooter={false}
								/>
							</div>
						</div>
					</div>

					{/* Instructions */}
					<RecipeInstructionsList
						instructions={recipe.instructions}
						checkedSteps={checkedSteps}
						onToggleStep={toggleStep}
						substitutions={noSubstitutions}
						recipeName={recipe.title}
					/>
				</div>

				{/* Save / Sign-up CTA */}
				<div className="mt-12 mb-8 text-center">
					<div className="bg-accent/5 inline-block rounded-2xl border px-8 py-6">
						{isLoggedIn ? (
							<>
								<p className="font-serif text-lg">Like this recipe?</p>
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
								<p className="font-serif text-lg">Like this recipe?</p>
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
