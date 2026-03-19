import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data,
	Form,
	Link,
	redirect,
	useActionData,
	useNavigation,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	checkAndRecordAiUsage,
	getAiUsageRemaining,
} from '#app/utils/ai-rate-limit.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	AI_FEATURE_USED,
	RECIPE_AI_GENERATED,
} from '#app/utils/posthog-events.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import {
	generateRecipeFromInventory,
	type GeneratedRecipe,
} from '#app/utils/recipe-generation-llm.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/generate.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Generate Recipe | Quartermaster' }]
}

const DAILY_GENERATION_LIMIT = 10

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireProTier(request)

	const [inventoryCount, generationsRemaining] = await Promise.all([
		prisma.inventoryItem.count({ where: { householdId } }),
		getAiUsageRemaining(
			userId,
			'recipe_generation_llm_call',
			DAILY_GENERATION_LIMIT,
		),
	])

	return { inventoryCount, generationsRemaining }
}

type ActionData =
	| { intent: 'generate'; recipe: GeneratedRecipe; error: null }
	| { intent: 'generate'; recipe: null; error: string }

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'generate') {
		const { allowed } = await checkAndRecordAiUsage(
			userId,
			'recipe_generation_llm_call',
			DAILY_GENERATION_LIMIT,
		)
		if (!allowed) {
			return data({
				intent: 'generate' as const,
				recipe: null,
				error: `You've reached the daily limit of ${DAILY_GENERATION_LIMIT} recipe generations. Try again tomorrow!`,
			})
		}

		const inventory = await prisma.inventoryItem.findMany({
			where: { householdId },
			select: {
				name: true,
			},
		})

		if (inventory.length === 0) {
			return data({
				intent: 'generate' as const,
				recipe: null,
				error:
					'You need at least a few inventory items to generate a recipe. Add some items to your pantry first!',
			})
		}

		const mealType = formData.get('mealType') as string | null
		const quickMeal = formData.get('quickMeal') === 'on'
		const rawDescription = ((formData.get('description') as string) || '')
			.trim()
			.slice(0, 200)

		const preferences = {
			...(mealType &&
				['breakfast', 'lunch', 'dinner', 'snack'].includes(mealType) && {
					mealType: mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
				}),
			...(quickMeal && { quickMeal: true }),
			...(rawDescription && { description: rawDescription }),
		}

		const result = await generateRecipeFromInventory(inventory, preferences)

		if ('error' in result) {
			return data({
				intent: 'generate' as const,
				recipe: null,
				error: result.error,
			})
		}

		const recipe = result

		captureServerEvent(userId, RECIPE_AI_GENERATED, {
			recipe_title: recipe.title,
			ingredient_count: recipe.ingredients.length,
		})
		captureServerEvent(userId, AI_FEATURE_USED, {
			feature: 'recipe_generation',
		})

		return data({
			intent: 'generate' as const,
			recipe,
			error: null,
		})
	}

	if (intent === 'save') {
		const title = formData.get('title') as string
		const description = (formData.get('description') as string) || null
		const servings = Math.min(
			999,
			Math.max(1, parseInt(formData.get('servings') as string, 10) || 4),
		)
		const prepTime = formData.get('prepTime')
			? Math.min(
					1440,
					Math.max(0, parseInt(formData.get('prepTime') as string, 10) || 0),
				)
			: null
		const cookTime = formData.get('cookTime')
			? Math.min(
					1440,
					Math.max(0, parseInt(formData.get('cookTime') as string, 10) || 0),
				)
			: null

		// Parse ingredients
		const ingredients: Array<{
			name: string
			amount?: string
			unit?: string
			notes?: string
		}> = []
		let i = 0
		while (formData.has(`ingredients[${i}].name`) && i < 200) {
			const name = formData.get(`ingredients[${i}].name`) as string
			if (name.trim()) {
				ingredients.push({
					name,
					amount:
						(formData.get(`ingredients[${i}].amount`) as string) || undefined,
					unit: (formData.get(`ingredients[${i}].unit`) as string) || undefined,
					notes:
						(formData.get(`ingredients[${i}].notes`) as string) || undefined,
				})
			}
			i++
		}

		// Parse instructions
		const instructions: Array<{ content: string }> = []
		i = 0
		while (formData.has(`instructions[${i}].content`) && i < 200) {
			const content = formData.get(`instructions[${i}].content`) as string
			if (content.trim()) {
				instructions.push({ content })
			}
			i++
		}

		if (!title) {
			return data(
				{
					intent: 'generate' as const,
					recipe: null,
					error: 'Title is required.',
				} satisfies ActionData,
				{ status: 400 },
			)
		}

		const recipe = await prisma.recipe.create({
			data: {
				title,
				description,
				servings,
				prepTime,
				cookTime,
				isAiGenerated: true,
				userId,
				householdId,
				ingredients: {
					create: ingredients.map((ing, order) => ({
						name: ing.name,
						amount: ing.amount || null,
						unit: ing.unit || null,
						notes: ing.notes || null,
						order,
					})),
				},
				instructions: {
					create: instructions.map((inst, order) => ({
						content: inst.content,
						order,
					})),
				},
			},
			select: { id: true },
		})

		return redirect(`/recipes/${recipe.id}`)
	}

	return data(
		{
			intent: 'generate' as const,
			recipe: null,
			error: 'Invalid action',
		} satisfies ActionData,
		{ status: 400 },
	)
}

export default function GenerateRecipe({ loaderData }: Route.ComponentProps) {
	const { inventoryCount, generationsRemaining } = loaderData
	const actionData = useActionData<typeof action>() as ActionData | undefined
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	const submittingIntent =
		isSubmitting && navigation.formData
			? navigation.formData.get('intent')
			: null

	const recipe = actionData?.recipe ?? null
	const error = actionData?.error ?? null
	const hasRecipe = recipe && !error

	return (
		<div className="container max-w-2xl py-6 pb-20 md:pb-6">
			<div className="mb-6 flex items-center gap-2">
				<Icon name="sparkles" className="h-6 w-6 text-violet-500" />
				<h1 className="text-2xl font-bold">Generate Recipe</h1>
			</div>

			{/* Phase A: Preference selection */}
			{!hasRecipe && submittingIntent !== 'generate' && (
				<div className="space-y-6">
					<p className="text-muted-foreground">
						Create a recipe from your {inventoryCount} inventory item
						{inventoryCount !== 1 ? 's' : ''}.
					</p>

					{inventoryCount === 0 && (
						<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
							You need some inventory items first.{' '}
							<Link to="/inventory" className="font-medium underline">
								Add items to your pantry
							</Link>{' '}
							to get started.
						</div>
					)}

					{error && (
						<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
							{error}
						</div>
					)}

					<Form method="POST" className="space-y-5">
						<input type="hidden" name="intent" value="generate" />

						<div>
							<textarea
								name="description"
								maxLength={200}
								rows={2}
								placeholder="What do you want to make? e.g. gyoza dipping sauce, quick pasta for two"
								className="border-input bg-background placeholder:text-muted-foreground/60 w-full rounded-lg border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
							/>
							<p className="text-muted-foreground mt-1 text-xs">
								Leave blank for a surprise — or describe what you're in the mood
								for
							</p>
						</div>

						<div className="flex flex-wrap items-center gap-2">
							{[
								{ value: '', label: 'Any' },
								{ value: 'breakfast', label: 'Breakfast' },
								{ value: 'lunch', label: 'Lunch' },
								{ value: 'dinner', label: 'Dinner' },
								{ value: 'snack', label: 'Snack' },
							].map((option) => (
								<label
									key={option.value}
									className="border-input has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:text-primary cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors"
								>
									<input
										type="radio"
										name="mealType"
										value={option.value}
										defaultChecked={option.value === ''}
										className="sr-only"
									/>
									{option.label}
								</label>
							))}

							<span className="text-border mx-1 hidden sm:inline">|</span>

							<label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-input px-3 py-1 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:text-primary">
								<input
									type="checkbox"
									name="quickMeal"
									className="sr-only"
								/>
								<Icon name="clock" size="sm" />
								Under 30 min
							</label>
						</div>

						<div className="flex flex-col items-center gap-2 pt-2">
							<StatusButton
								type="submit"
								size="lg"
								status={submittingIntent === 'generate' ? 'pending' : 'idle'}
								disabled={
									isSubmitting ||
									inventoryCount === 0 ||
									generationsRemaining === 0
								}
							>
								<Icon name="sparkles" size="sm" />
								Generate Recipe
							</StatusButton>
							{generationsRemaining <= 3 && (
								<p className="text-muted-foreground text-xs">
									{generationsRemaining === 0
										? 'Daily limit reached — try again tomorrow'
										: `${generationsRemaining} generation${generationsRemaining !== 1 ? 's' : ''} remaining today`}
								</p>
							)}
						</div>
					</Form>
				</div>
			)}

			{/* Phase B: Loading */}
			{submittingIntent === 'generate' && (
				<div className="flex flex-col items-center justify-center gap-4 py-16">
					<Icon
						name="update"
						className="text-muted-foreground h-8 w-8 animate-spin"
					/>
					<p className="text-muted-foreground text-lg">
						Creating a recipe from your ingredients...
					</p>
				</div>
			)}

			{/* Phase C: Preview */}
			{hasRecipe && (
				<div className="space-y-6">
					<div className="space-y-4 rounded-lg border p-6">
						<div className="flex items-start justify-between gap-2">
							<h2 className="text-xl font-semibold">{recipe.title}</h2>
							<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary dark:border-primary/30 dark:bg-primary/10 dark:text-primary">
								<Icon name="sparkles" className="size-3" />
								AI Generated
							</span>
						</div>
						{recipe.description && (
							<p className="text-muted-foreground text-sm">
								{recipe.description}
							</p>
						)}
						<div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
							<span>Servings: {recipe.servings}</span>
							{recipe.prepTime != null && (
								<span>Prep: {recipe.prepTime} min</span>
							)}
							{recipe.cookTime != null && (
								<span>Cook: {recipe.cookTime} min</span>
							)}
						</div>

						{recipe.ingredients.length > 0 && (
							<div>
								<h3 className="mb-2 font-medium">
									Ingredients ({recipe.ingredients.length})
								</h3>
								<ul className="space-y-1 text-sm">
									{recipe.ingredients.map((ing, i) => (
										<li key={i} className="flex gap-1">
											<span className="text-muted-foreground">-</span>
											{ing.amount && (
												<span className="font-medium">{ing.amount}</span>
											)}
											{ing.unit && <span>{ing.unit}</span>}
											<span>{ing.name}</span>
											{ing.notes && (
												<span className="text-muted-foreground">
													, {ing.notes}
												</span>
											)}
										</li>
									))}
								</ul>
							</div>
						)}

						{recipe.instructions.length > 0 && (
							<div>
								<h3 className="mb-2 font-medium">
									Instructions ({recipe.instructions.length} steps)
								</h3>
								<ol className="space-y-2 text-sm">
									{recipe.instructions.map((inst, i) => (
										<li key={i} className="flex gap-2">
											<span className="text-muted-foreground shrink-0">
												{i + 1}.
											</span>
											<span>{inst.content}</span>
										</li>
									))}
								</ol>
							</div>
						)}
					</div>

					{/* Save form */}
					<Form method="POST">
						<input type="hidden" name="intent" value="save" />
						<input type="hidden" name="title" value={recipe.title} />
						<input
							type="hidden"
							name="description"
							value={recipe.description ?? ''}
						/>
						<input type="hidden" name="servings" value={recipe.servings} />
						{recipe.prepTime != null && (
							<input type="hidden" name="prepTime" value={recipe.prepTime} />
						)}
						{recipe.cookTime != null && (
							<input type="hidden" name="cookTime" value={recipe.cookTime} />
						)}
						{recipe.ingredients.map((ing, i) => (
							<div key={i}>
								<input
									type="hidden"
									name={`ingredients[${i}].name`}
									value={ing.name}
								/>
								<input
									type="hidden"
									name={`ingredients[${i}].amount`}
									value={ing.amount ?? ''}
								/>
								<input
									type="hidden"
									name={`ingredients[${i}].unit`}
									value={ing.unit ?? ''}
								/>
								<input
									type="hidden"
									name={`ingredients[${i}].notes`}
									value={ing.notes ?? ''}
								/>
							</div>
						))}
						{recipe.instructions.map((inst, i) => (
							<input
								key={i}
								type="hidden"
								name={`instructions[${i}].content`}
								value={inst.content}
							/>
						))}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => window.location.reload()}
							>
								Try Again
							</Button>
							<StatusButton
								type="submit"
								status={submittingIntent === 'save' ? 'pending' : 'idle'}
								disabled={isSubmitting}
							>
								Save Recipe
							</StatusButton>
						</div>
					</Form>
				</div>
			)}
		</div>
	)
}
