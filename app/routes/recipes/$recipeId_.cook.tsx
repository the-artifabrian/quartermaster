import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/$recipeId_.cook.ts'

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
			servings: true,
			userId: true,
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
		},
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.userId === userId, 'Not authorized', { status: 403 })

	return { recipe }
}

export default function CookMode({ loaderData }: Route.ComponentProps) {
	const { recipe } = loaderData
	const [currentStep, setCurrentStep] = useState(0)
	const [showIngredients, setShowIngredients] = useState(false)

	// Step 0 = prep (ingredients), steps 1..N = instructions
	const totalSteps = recipe.instructions.length + 1
	const isPrepStep = currentStep === 0
	const instruction = isPrepStep ? null : recipe.instructions[currentStep - 1]
	const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0

	// Wake Lock API to keep screen on while cooking
	useEffect(() => {
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

		// Re-acquire wake lock if page becomes visible again
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
	}, [])

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background">
			{/* Top bar */}
			<div className="flex items-center justify-between border-b px-4 py-3">
				<Button asChild variant="ghost" size="sm">
					<Link to={`/recipes/${recipe.id}`}>
						<Icon name="arrow-left" size="sm" />
						Exit
					</Link>
				</Button>
				<h1 className="line-clamp-1 text-sm font-semibold">{recipe.title}</h1>
				<Button
					variant={showIngredients ? 'secondary' : 'ghost'}
					size="sm"
					onClick={() => setShowIngredients(!showIngredients)}
				>
					Ingredients
				</Button>
			</div>

			{/* Progress bar */}
			<div className="h-1 bg-muted">
				<div
					className="h-full bg-primary transition-all duration-300"
					style={{ width: `${progress}%` }}
				/>
			</div>

			{/* Collapsible ingredients panel */}
			{showIngredients && (
				<div className="max-h-[40vh] overflow-y-auto border-b bg-muted/30 px-6 py-4">
					<h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
						Ingredients ({recipe.servings} servings)
					</h2>
					<ul className="space-y-1.5">
						{recipe.ingredients.map((ingredient) => (
							<li key={ingredient.id} className="flex items-start gap-2 text-sm">
								<span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
								<span>
									{ingredient.amount && (
										<span className="font-medium">
											{ingredient.amount}{' '}
										</span>
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
			)}

			{/* Main step content */}
			<div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
				{isPrepStep ? (
					<div className="w-full max-w-md">
						<p className="mb-2 text-center text-sm font-medium text-muted-foreground">
							Prep
						</p>
						<h2 className="mb-6 text-center text-2xl font-semibold md:text-3xl">
							Gather your ingredients
						</h2>
						<ul className="space-y-3">
							{recipe.ingredients.map((ingredient) => (
								<li
									key={ingredient.id}
									className="flex items-start gap-3 text-lg"
								>
									<span className="mt-2.5 block size-2 shrink-0 rounded-full bg-primary" />
									<span>
										{ingredient.amount && (
											<span className="font-medium">
												{ingredient.amount}{' '}
											</span>
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
				) : instruction ? (
					<>
						<p className="mb-6 text-sm font-medium text-muted-foreground">
							Step {currentStep} of {totalSteps - 1}
						</p>
						<p className="max-w-2xl text-center text-2xl leading-relaxed md:text-3xl">
							{instruction.content}
						</p>
					</>
				) : (
					<p className="text-2xl text-muted-foreground">No instructions found</p>
				)}
			</div>

			{/* Bottom navigation */}
			<div className="flex items-center justify-between border-t px-4 py-4">
				<Button
					variant="outline"
					size="lg"
					className={cn('py-6 text-lg', currentStep === 0 && 'invisible')}
					onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
					disabled={currentStep === 0}
				>
					<Icon name="arrow-left" size="sm" />
					Previous
				</Button>

				{currentStep < totalSteps - 1 ? (
					<Button
						size="lg"
						className="py-6 text-lg"
						onClick={() => setCurrentStep((s) => Math.min(totalSteps - 1, s + 1))}
					>
						{isPrepStep ? 'Start Cooking' : 'Next'}
						<Icon name="arrow-right" size="sm" />
					</Button>
				) : (
					<Button asChild size="lg" className="py-6 text-lg">
						<Link to={`/recipes/${recipe.id}`}>
							<Icon name="check" size="sm" />
							Done
						</Link>
					</Button>
				)}
			</div>
		</div>
	)
}
