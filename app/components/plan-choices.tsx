import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	type PlanSelectorMenu,
	type RecipeSelectorRecipe,
} from './recipe-selector.tsx'

export type PlanChoiceData = {
	recipes: RecipeSelectorRecipe[]
	menus: PlanSelectorMenu[]
}

export type PlanChoiceState =
	| { status: 'idle' | 'loading' }
	| ({ status: 'success' } & PlanChoiceData)
	| { status: 'error' }

export type PlanChoices = {
	state: PlanChoiceState
	load: () => void
}

export function PlanChoiceRequestState({
	state,
	onRetry,
	onCancel,
	subject,
}: {
	state: 'idle' | 'loading' | 'error'
	onRetry: () => void
	onCancel: () => void
	subject: string
}) {
	return (
		<div className="space-y-3">
			<div className="flex items-start justify-between gap-3">
				{state === 'error' ? (
					<div role="alert">
						<p className="text-sm">Couldn&rsquo;t load {subject}.</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={onRetry}
						>
							Try again
						</Button>
					</div>
				) : (
					<p
						role="status"
						aria-live="polite"
						className="text-muted-foreground text-sm"
					>
						Loading {subject}…
					</p>
				)}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={onCancel}
					aria-label="Close picker"
				>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
		</div>
	)
}

function isNullableNumber(value: unknown): value is number | null {
	return value === null || typeof value === 'number'
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string'
}

function isPlanChoiceData(value: unknown): value is PlanChoiceData {
	if (!value || typeof value !== 'object') return false
	if (!('recipes' in value) || !Array.isArray(value.recipes)) return false
	if (!('menus' in value) || !Array.isArray(value.menus)) return false

	return (
		value.recipes.every(
			(recipe) =>
				recipe != null &&
				typeof recipe === 'object' &&
				'id' in recipe &&
				typeof recipe.id === 'string' &&
				'title' in recipe &&
				typeof recipe.title === 'string' &&
				'totalTime' in recipe &&
				isNullableNumber(recipe.totalTime) &&
				'yieldAmount' in recipe &&
				isNullableNumber(recipe.yieldAmount) &&
				'yieldLabel' in recipe &&
				isNullableString(recipe.yieldLabel) &&
				'isFavorite' in recipe &&
				typeof recipe.isFavorite === 'boolean' &&
				'image' in recipe &&
				(recipe.image === null ||
					(typeof recipe.image === 'object' &&
						'objectKey' in recipe.image &&
						typeof recipe.image.objectKey === 'string')),
		) &&
		value.menus.every(
			(menu) =>
				menu != null &&
				typeof menu === 'object' &&
				'id' in menu &&
				typeof menu.id === 'string' &&
				'title' in menu &&
				typeof menu.title === 'string' &&
				'recipeCount' in menu &&
				typeof menu.recipeCount === 'number' &&
				'noteCount' in menu &&
				typeof menu.noteCount === 'number' &&
				'recipeTitles' in menu &&
				Array.isArray(menu.recipeTitles) &&
				menu.recipeTitles.every((title) => typeof title === 'string'),
		)
	)
}

/**
 * Owns the one in-flight request and successful cache for a rendered Plan.
 * Consumers only need to call load when their picker opens and render state.
 */
export function usePlanChoices(): PlanChoices {
	const [state, setState] = useState<PlanChoiceState>({ status: 'idle' })
	const successfulResult = useRef<PlanChoiceData>(null)
	const inFlight = useRef<Promise<void>>(null)
	const requestController = useRef<AbortController>(null)

	const load = useCallback(() => {
		if (successfulResult.current || inFlight.current) return

		const controller = new AbortController()
		requestController.current = controller
		setState({ status: 'loading' })

		const request = (async () => {
			try {
				const response = await fetch(
					new URL('/resources/plan-choices', window.location.origin),
					{
						signal: controller.signal,
						headers: { Accept: 'application/json' },
						credentials: 'same-origin',
					},
				)
				if (!response.ok) throw new Error(`Request failed: ${response.status}`)
				const result: unknown = await response.json()
				if (!isPlanChoiceData(result)) {
					throw new Error('Invalid Plan choice response')
				}
				successfulResult.current = result
				setState({ status: 'success', ...result })
			} catch {
				if (!controller.signal.aborted) setState({ status: 'error' })
			} finally {
				if (requestController.current === controller) {
					requestController.current = null
					inFlight.current = null
				}
			}
		})()
		inFlight.current = request
	}, [])

	useEffect(
		() => () => {
			requestController.current?.abort()
		},
		[],
	)

	return { state, load }
}
