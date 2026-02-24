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
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	generateRecipeFromInventory,
	type GeneratedRecipe,
} from '#app/utils/recipe-generation-llm.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
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

	const now = new Date()
	const startOfDay = new Date(now)
	startOfDay.setHours(0, 0, 0, 0)
	const threeDaysFromNow = new Date(now.getTime() + 3 * 86400000)

	const [inventoryCount, expiringCount, todayGenerations] = await Promise.all([
		prisma.inventoryItem.count({ where: { householdId } }),
		prisma.inventoryItem.count({
			where: {
				householdId,
				expiresAt: { gte: now, lte: threeDaysFromNow },
			},
		}),
		prisma.usageEvent.count({
			where: {
				userId,
				type: 'recipe_generation_llm_call',
				createdAt: { gte: startOfDay },
			},
		}),
	])

	return {
		inventoryCount,
		expiringCount,
		generationsRemaining: Math.max(
			0,
			DAILY_GENERATION_LIMIT - todayGenerations,
		),
	}
}

type ActionData =
	| { intent: 'generate'; recipe: GeneratedRecipe; error: null }
	| { intent: 'generate'; recipe: null; error: string }

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'generate') {
		// Check daily generation limit
		const startOfDay = new Date()
		startOfDay.setHours(0, 0, 0, 0)
		const todayCount = await prisma.usageEvent.count({
			where: {
				userId,
				type: 'recipe_generation_llm_call',
				createdAt: { gte: startOfDay },
			},
		})
		if (todayCount >= DAILY_GENERATION_LIMIT) {
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
				location: true,
				expiresAt: true,
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

		const preferences = {
			...(mealType &&
				['breakfast', 'lunch', 'dinner', 'snack'].includes(mealType) && {
					mealType: mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
				}),
			...(quickMeal && { quickMeal: true }),
		}

		const result = await generateRecipeFromInventory(inventory, preferences)

		const isError = 'error' in result
		trackEvent(userId, householdId, 'recipe_generation_llm_call', {
			inventoryCount: inventory.length,
			mealType: preferences.mealType ?? null,
			quickMeal: preferences.quickMeal ?? false,
			success: !isError,
		})

		if (isError) {
			return data({
				intent: 'generate' as const,
				recipe: null,
				error: result.error,
			})
		}

		const recipe = result

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

		void emitHouseholdEvent({
			type: 'recipe_created',
			payload: { recipeId: recipe.id, title },
			userId,
			householdId,
		})

		trackEvent(userId, householdId, 'recipe_generation_saved', {
			recipeId: recipe.id,
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
	const { inventoryCount, expiringCount, generationsRemaining } = loaderData
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
			<Link
				to="/recipes"
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
			>
				<Icon name="arrow-left" size="sm" />
				Back to recipes
			</Link>
			<div className="mb-6 flex items-center gap-2">
				<Icon name="sparkles" className="h-6 w-6 text-violet-500" />
				<h1 className="text-2xl font-bold">Generate Recipe</h1>
			</div>

			{/* Phase A: Preference selection */}
			{!hasRecipe && submittingIntent !== 'generate' && (
				<div className="space-y-6">
					<p className="text-muted-foreground">
						Create a recipe from your {inventoryCount} inventory item
						{inventoryCount !== 1 ? 's' : ''}
						{expiringCount > 0 && (
							<> ({expiringCount} expiring soon — they'll be prioritized)</>
						)}
						.
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

					<Form method="POST" className="space-y-6">
						<input type="hidden" name="intent" value="generate" />

						<fieldset className="space-y-3">
							<Label asChild>
								<legend>Meal type (optional)</legend>
							</Label>
							<div className="flex flex-wrap gap-2">
								{[
									{ value: '', label: 'Any' },
									{ value: 'breakfast', label: 'Breakfast' },
									{ value: 'lunch', label: 'Lunch' },
									{ value: 'dinner', label: 'Dinner' },
									{ value: 'snack', label: 'Snack' },
								].map((option) => (
									<label
										key={option.value}
										className="border-input has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
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
							</div>
						</fieldset>

						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								name="quickMeal"
								className="border-input h-4 w-4 rounded"
							/>
							<span className="text-sm">Quick meal (30 minutes or less)</span>
						</label>

						<div className="flex flex-col-reverse items-end gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
							{generationsRemaining <= 3 && (
								<p className="text-muted-foreground text-xs">
									{generationsRemaining === 0
										? 'Daily limit reached — try again tomorrow'
										: `${generationsRemaining} generation${generationsRemaining !== 1 ? 's' : ''} remaining today`}
								</p>
							)}
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => history.back()}
								>
									Cancel
								</Button>
								<StatusButton
									type="submit"
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
							</div>
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
