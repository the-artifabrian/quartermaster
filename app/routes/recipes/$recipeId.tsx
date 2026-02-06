import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { format } from 'date-fns'
import { Img } from 'openimg/react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Form, Link, useFetcher, useSearchParams } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { CookingLogSchema } from '#app/utils/cooking-log-validation.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scaleAmount } from '#app/utils/fractions.ts'
import { subtractRecipeIngredientsFromInventory } from '#app/utils/inventory-subtract.server.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
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

	const cookingLogs = await prisma.cookingLog.findMany({
		where: { recipeId, userId },
		orderBy: { cookedAt: 'desc' },
		take: 10,
		select: {
			id: true,
			cookedAt: true,
			notes: true,
			rating: true,
		},
	})

	return { recipe, cookingLogs }
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

	if (intent === 'logCook') {
		const submission = parseWithZod(formData, { schema: CookingLogSchema })
		if (submission.status !== 'success') {
			return { success: false }
		}

		await prisma.cookingLog.create({
			data: {
				recipeId,
				userId,
				cookedAt: submission.value.cookedAt ?? new Date(),
				notes: submission.value.notes || null,
				rating: submission.value.rating ?? null,
			},
		})

		const subtractInventory = formData.get('subtractInventory') === 'on'
		if (subtractInventory) {
			const servingRatio = parseFloat(
				String(formData.get('servingRatio') ?? '1'),
			)
			await subtractRecipeIngredientsFromInventory(
				recipeId,
				userId,
				isNaN(servingRatio) || servingRatio <= 0 ? 1 : servingRatio,
			)
		}

		return { success: true }
	}

	if (intent === 'deleteCookLog') {
		const logId = formData.get('logId')
		invariantResponse(typeof logId === 'string', 'Log ID is required')

		const log = await prisma.cookingLog.findFirst({
			where: { id: logId, userId, recipeId },
		})
		invariantResponse(log, 'Log not found', { status: 404 })

		await prisma.cookingLog.delete({ where: { id: logId } })
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

function StarRating({
	value,
	onChange,
}: {
	value: number
	onChange: (rating: number) => void
}) {
	return (
		<div className="flex gap-0.5">
			{[1, 2, 3, 4, 5].map((star) => (
				<button
					key={star}
					type="button"
					onClick={() => onChange(star === value ? 0 : star)}
					className="text-amber-500 hover:scale-110 transition-transform"
				>
					<Icon
						name={star <= value ? 'star-filled' : 'star'}
						size="md"
					/>
				</button>
			))}
		</div>
	)
}

function StarDisplay({ rating }: { rating: number }) {
	return (
		<div className="flex gap-0.5">
			{[1, 2, 3, 4, 5].map((star) => (
				<Icon
					key={star}
					name={star <= rating ? 'star-filled' : 'star'}
					size="sm"
					className="text-amber-500"
				/>
			))}
		</div>
	)
}

export default function RecipeDetail({ loaderData }: Route.ComponentProps) {
	const { recipe, cookingLogs } = loaderData
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
	const [showCookForm, setShowCookForm] = useState(false)
	const [cookRating, setCookRating] = useState(0)
	const cookFetcher = useFetcher({ key: 'log-cook' })
	const prevCookFetcherState = useRef(cookFetcher.state)

	const servingsParam = searchParams.get('servings')
	const currentServings = servingsParam
		? Math.max(1, parseInt(servingsParam, 10) || recipe.servings)
		: recipe.servings
	const ratio = currentServings / recipe.servings
	const isScaled = currentServings !== recipe.servings

	// Close form after successful submission
	if (
		prevCookFetcherState.current !== 'idle' &&
		cookFetcher.state === 'idle' &&
		cookFetcher.data?.success
	) {
		setShowCookForm(false)
		setCookRating(0)
	}
	prevCookFetcherState.current = cookFetcher.state

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
		<div className="container max-w-4xl py-6">
			{/* Header */}
			<div className="mb-4">
				<Link
					to="/recipes"
					className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
				>
					<Icon name="arrow-left" size="sm" />
					Back to recipes
				</Link>
				<h1 className="text-3xl font-bold tracking-tight">
					{recipe.title}
				</h1>
			</div>

			{/* Action buttons */}
			<div className="mb-6 flex flex-wrap gap-2">
				<favoriteFetcher.Form method="POST">
					<input type="hidden" name="intent" value="toggleFavorite" />
					<Button
						type="submit"
						variant="ghost"
						size="sm"
						title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
						className={isFavorite ? 'text-red-500 hover:text-red-600' : ''}
					>
						<Icon name={isFavorite ? 'heart-filled' : 'heart'} size="sm" />
						{isFavorite ? 'Favorited' : 'Favorite'}
					</Button>
				</favoriteFetcher.Form>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setShowCookForm((v) => !v)}
					className={showCookForm ? 'text-primary' : ''}
				>
					<Icon name="check" size="sm" />
					I Made This
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={wakeLock.toggle}
					title={
						wakeLock.isActive
							? 'Screen will stay on'
							: 'Keep screen on while cooking'
					}
					className={wakeLock.isActive ? 'text-primary' : ''}
				>
					<Icon name="clock" size="sm" />
					{wakeLock.isActive ? 'Screen On' : 'Keep Awake'}
				</Button>
				<Button asChild variant="ghost" size="sm">
					<Link to={`/recipes/${recipe.id}/edit`}>
						<Icon name="pencil-1" size="sm" />
						Edit
					</Link>
				</Button>
			</div>

			{/* "I Made This" inline form */}
			{showCookForm && (
				<div className="bg-muted/30 mb-6 rounded-xl border p-4">
					<h3 className="mb-3 font-semibold">Log Cooking</h3>
					<cookFetcher.Form method="POST" className="space-y-3">
						<input type="hidden" name="intent" value="logCook" />
						<input type="hidden" name="rating" value={cookRating || ''} />
						<input type="hidden" name="servingRatio" value={ratio} />
						<div className="flex flex-wrap gap-4">
							<div>
								<label
									htmlFor="cookedAt"
									className="text-muted-foreground mb-1 block text-sm"
								>
									Date
								</label>
								<input
									type="date"
									id="cookedAt"
									name="cookedAt"
									defaultValue={format(new Date(), 'yyyy-MM-dd')}
									className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
								/>
							</div>
							<div>
								<label className="text-muted-foreground mb-1 block text-sm">
									Rating
								</label>
								<StarRating value={cookRating} onChange={setCookRating} />
							</div>
						</div>
						<div>
							<label
								htmlFor="cookNotes"
								className="text-muted-foreground mb-1 block text-sm"
							>
								Notes (optional)
							</label>
							<textarea
								id="cookNotes"
								name="notes"
								rows={2}
								placeholder="How did it turn out? Any adjustments?"
								className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
							/>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								name="subtractInventory"
								className="size-4 rounded"
							/>
							Subtract ingredients from inventory
						</label>
						<div className="flex gap-2">
							<Button type="submit" size="sm">
								Save
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => {
									setShowCookForm(false)
									setCookRating(0)
								}}
							>
								Cancel
							</Button>
						</div>
					</cookFetcher.Form>
				</div>
			)}

			{/* Image */}
			{recipe.image && (
				<div className="bg-muted mb-6 aspect-[16/9] overflow-hidden rounded-xl max-md:-mx-4 max-md:rounded-none">
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
			<div className="bg-muted/30 mb-6 flex flex-wrap items-center gap-4 rounded-xl px-5 py-4 text-sm">
				{/* Servings with scaling controls */}
				<span className="flex items-center gap-1">
					<Icon name="avatar" size="sm" className="text-muted-foreground" />
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
				<span className="text-border hidden md:inline">|</span>
				{recipe.prepTime && (
					<span className="text-muted-foreground flex items-center gap-1">
						<Icon name="clock" size="sm" />
						Prep: {recipe.prepTime} min
					</span>
				)}
				{recipe.cookTime && (
					<>
						<span className="text-border hidden md:inline">|</span>
						<span className="text-muted-foreground flex items-center gap-1">
							<Icon name="clock" size="sm" />
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
			</div>

			{/* Tags */}
			{recipe.tags.length > 0 && (
				<div className="mb-6 flex flex-wrap gap-2">
					{recipe.tags.map((tag) => (
						<span
							key={tag.id}
							className="bg-primary/10 text-primary rounded-full px-3 py-1 text-sm font-medium"
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
					<h2 className="mb-4 text-lg font-semibold">Recipe Notes</h2>
					<div className="bg-muted/50 rounded-lg p-4">
						<pre className="font-sans text-sm whitespace-pre-wrap">
							{recipe.rawText}
						</pre>
					</div>
				</div>
			)}

			<div className="grid gap-8 md:grid-cols-[1fr_2fr]">
				{/* Ingredients */}
				<div className="bg-muted/20 rounded-xl p-5">
					<div className="mb-4 flex items-center gap-2">
						<h2 className="text-lg font-semibold">Ingredients</h2>
						{isScaled && (
							<span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
								Scaled
							</span>
						)}
					</div>
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
					<h2 className="mb-4 text-lg font-semibold">Instructions</h2>
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

			{/* Cooking History */}
			{cookingLogs.length > 0 && (
				<div className="mt-10">
					<h2 className="mb-4 text-lg font-semibold">Cooking History</h2>
					<div className="space-y-3">
						{cookingLogs.map((log) => (
							<CookingLogEntry key={log.id} log={log} />
						))}
					</div>
				</div>
			)}
		</div>
	)
}

function CookingLogEntry({
	log,
}: {
	log: { id: string; cookedAt: Date; notes: string | null; rating: number | null }
}) {
	const dc = useDoubleCheck()

	return (
		<div className="bg-muted/20 flex items-start gap-3 rounded-lg p-4">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">
						{format(new Date(log.cookedAt), 'MMM d, yyyy')}
					</span>
					{log.rating && <StarDisplay rating={log.rating} />}
				</div>
				{log.notes && (
					<p className="text-muted-foreground mt-1 text-sm">{log.notes}</p>
				)}
			</div>
			<Form method="POST">
				<input type="hidden" name="intent" value="deleteCookLog" />
				<input type="hidden" name="logId" value={log.id} />
				<StatusButton
					type="submit"
					size="sm"
					variant="ghost"
					status="idle"
					{...dc.getButtonProps()}
				>
					<Icon name="trash" size="sm" />
				</StatusButton>
			</Form>
		</div>
	)
}
