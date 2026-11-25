import { Img } from 'openimg/react'
import { useState } from 'react'
import {
	Link,
	useFetcher,
	useRouteLoaderData,
	useSearchParams,
} from 'react-router'
import { IngredientList } from '#app/components/recipe-ingredient-list.tsx'
import { RecipeInstructionsList } from '#app/components/recipe-instructions-list.tsx'
import { RecipeMetadataCard } from '#app/components/recipe-metadata-card.tsx'
import { RecipeIngredientsControls } from '#app/components/recipe-scale-control.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	formatScaleMultiplier,
	ScaleMultiplierSchema,
} from '#app/utils/menu-validation.ts'
import { IMG_SIZES } from '#app/utils/image-route.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipeJsonLd } from '#app/utils/recipe-detail.ts'

import { type SharedRecipe } from '#app/utils/share-menu.server.ts'

export function SharedRecipeView({
	loaderData,
	menuContext,
}: {
	loaderData: {
		recipe: SharedRecipe
		isLoggedIn: boolean
		alreadySaved: boolean
	}
	menuContext?: {
		id: string
		title: string
		note: string | null
		scaleMultiplier: number
	}
}) {
	const { recipe, isLoggedIn, alreadySaved } = loaderData
	const saveFetcher = useFetcher()
	const rootData = useRouteLoaderData('root') as
		{ requestInfo?: { origin?: string } } | undefined
	const origin = rootData?.requestInfo?.origin
	const recipeJsonLd = getRecipeJsonLd(recipe, origin)
	const [searchParams, setSearchParams] = useSearchParams()
	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => new Set(),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(() => new Set())
	const [ingredientsExpanded, setIngredientsExpanded] = useState(true)

	const scaleParam = ScaleMultiplierSchema.safeParse(searchParams.get('scale'))
	const ratio = scaleParam.success
		? scaleParam.data
		: (menuContext?.scaleMultiplier ?? 1)

	function updateScaleMultiplier(scaleMultiplier: number) {
		setSearchParams(
			(prev) => {
				// Drop the old `servings` parameter whenever an interaction writes the
				// canonical multiplier URL.
				prev.delete('servings')
				if (scaleMultiplier === 1 && !menuContext) {
					prev.delete('scale')
				} else {
					prev.set('scale', formatScaleMultiplier(scaleMultiplier))
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
				{menuContext && (
					<div className="mb-4">
						<Link
							to={`/share/menus/${menuContext.id}`}
							className="text-primary inline-flex items-center gap-2 text-sm hover:underline"
						>
							<Icon name="arrow-left" size="sm" />
							{menuContext.title}
						</Link>
						{menuContext.note && (
							<p className="text-muted-foreground mt-2 whitespace-pre-wrap">
								{menuContext.note}
							</p>
						)}
					</div>
				)}
				<p className="text-muted-foreground mb-2 text-sm">
					Shared{recipe.user.name ? ` by ${recipe.user.name}` : ''} on{' '}
					<Link to="/" className="text-primary hover:underline">
						Quartermaster
					</Link>
				</p>

				<div className="flex flex-col md:flex-row md:items-start md:gap-8">
					<div className="min-w-0 flex-1">
						<h1 className="font-serif text-[2rem] leading-[1.15] tracking-[-0.02em]">
							{recipe.title}
						</h1>
						<RecipeMetadataCard
							activeTime={recipe.activeTime}
							totalTime={recipe.totalTime}
							yieldAmount={recipe.yieldAmount}
							yieldLabel={recipe.yieldLabel}
							sourceUrl={recipe.sourceUrl}
							showYield={false}
						/>
					</div>

					{recipe.image && (
						<div className="order-first -mx-4 mb-5 shrink-0 sm:-mx-8 md:order-none md:mx-0 md:mb-0 md:w-[45%] lg:w-100">
							<Img
								src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
								alt={recipe.image.altText ?? recipe.title}
								className="md:border-border aspect-[16/10] w-full object-cover md:aspect-[4/3] md:rounded-md md:border"
								{...IMG_SIZES.hero}
							/>
						</div>
					)}
				</div>
				{recipe.description && (
					<p className="text-muted-foreground mt-5 text-base leading-relaxed text-pretty">
						{recipe.description}
					</p>
				)}

				<div className="mt-4 grid gap-5 md:mt-8 lg:grid-cols-[6fr_7fr] lg:gap-6">
					{/* Under the header: a demo's banner makes it taller (DemoBanner). */}
					<div className="min-w-0 lg:sticky lg:top-[calc(5rem+var(--demo-banner-h,0px))] lg:self-start">
						<div>
							<RecipeIngredientsControls
								scaleMultiplier={ratio}
								yieldAmount={recipe.yieldAmount}
								yieldLabel={recipe.yieldLabel}
								onScaleMultiplierChange={updateScaleMultiplier}
								ingredientsExpanded={ingredientsExpanded}
								onToggleIngredients={() =>
									setIngredientsExpanded((value) => !value)
								}
							/>
							<div
								id="ingredients-list"
								className={cn(!ingredientsExpanded && 'hidden lg:block')}
							>
								<IngredientList
									ingredients={recipe.ingredients}
									checkedIngredients={checkedIngredients}
									onToggle={toggleIngredient}
									ratio={ratio}
									recipeId={recipe.id}
									canAddToShopping={false}
								/>
							</div>
						</div>
					</div>

					<RecipeInstructionsList
						instructions={recipe.instructions}
						checkedSteps={checkedSteps}
						onToggleStep={toggleStep}
					/>
				</div>

				{menuContext ? (
					<div className="mt-10">
						<Button asChild>
							<Link to={`/share/menus/${menuContext.id}`}>Back to Menu</Link>
						</Button>
					</div>
				) : (
					<div className="mt-12 mb-8 text-center">
						<div className="bg-muted inline-block rounded-lg px-8 py-6">
							{isLoggedIn ? (
								<>
									<p className="font-serif text-lg">Like this Recipe?</p>
									<p className="text-muted-foreground mt-1 text-sm">
										Save it to your Recipes, then put it on your Plan.
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
													<Icon name="plus">Save to your Recipes</Icon>
												</Button>
											</saveFetcher.Form>
										)}
									</div>
								</>
							) : (
								<>
									<p className="font-serif text-lg">Like this Recipe?</p>
									<p className="text-muted-foreground mt-1 text-sm">
										Sign up to save it to your own Recipes and plan it for the
										week.
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
				)}
			</div>
		</>
	)
}
