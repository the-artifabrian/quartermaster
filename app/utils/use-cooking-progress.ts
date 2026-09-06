import { useEffect, useState } from 'react'
import { z } from 'zod'

const STORAGE_PREFIX = 'cooking-progress:v2:'
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SAVED_RECIPES = 50
const ProgressSchema = z.object({
	ingredients: z.array(z.string()),
	steps: z.array(z.string()),
	savedAt: z.number().finite(),
})
type StoredProgress = z.infer<typeof ProgressSchema>

type CookingContext = {
	userId: string
	householdId: string
	recipeId: string
	ingredients: Array<{
		id: string
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
		isHeading: boolean
		linkedRecipeId: string | null
	}>
	instructions: Array<{ id: string; content: string }>
}

function readProgress(key: string): StoredProgress | null {
	const raw = localStorage.getItem(key)
	if (!raw) return null
	try {
		const parsed = ProgressSchema.parse(JSON.parse(raw))
		const age = Date.now() - parsed.savedAt
		if (age >= 0 && age < EXPIRY_MS) return parsed
	} catch {
		// Invalid records are discarded just like expired records.
	}
	localStorage.removeItem(key)
	return null
}

function writeProgress(key: string, progress: StoredProgress) {
	if (!progress.ingredients.length && !progress.steps.length) {
		localStorage.removeItem(key)
	} else {
		localStorage.setItem(key, JSON.stringify(progress))
	}
}

function pruneProgress() {
	// Snapshot keys before removing records. Never adopt old, unscoped checks.
	const keys = Object.keys(localStorage).filter((key) =>
		key.startsWith(STORAGE_PREFIX),
	)
	const records = keys.flatMap((key) => {
		const progress = readProgress(key)
		return progress ? [{ key, savedAt: progress.savedAt }] : []
	})
	records.sort((a, b) => b.savedAt - a.savedAt)
	for (const { key } of records.slice(MAX_SAVED_RECIPES)) {
		localStorage.removeItem(key)
	}
}

export function useCookingProgress(context: CookingContext) {
	const storageKey = `${STORAGE_PREFIX}${JSON.stringify([
		context.userId,
		context.householdId,
		context.recipeId,
	])}`
	// Store exact content with checked IDs: a reused ID must not complete a
	// changed row. Display scale/unit preferences don't change canonical content.
	const ingredientTokens = new Map(
		context.ingredients
			.filter((ingredient) => !ingredient.isHeading)
			.map((i) => [
				i.id,
				JSON.stringify([
					i.id,
					i.name,
					i.amount,
					i.unit,
					i.notes,
					i.linkedRecipeId,
				]),
			]),
	)
	const stepTokens = new Map(
		context.instructions.map((i) => [i.id, JSON.stringify([i.id, i.content])]),
	)
	const contentKey = JSON.stringify([
		[...ingredientTokens.values()],
		[...stepTokens.values()],
	])
	const contextKey = JSON.stringify([storageKey, contentKey])
	const empty = {
		contextKey,
		ingredients: new Set<string>(),
		steps: new Set<string>(),
		dirty: false,
	}
	const [progress, setProgress] = useState(empty)
	// Reset during render so children never commit checks from another context.
	// Hydration happens afterwards; only explicit interactions can trigger saves.
	if (progress.contextKey !== contextKey) setProgress(empty)
	const current = progress.contextKey === contextKey ? progress : empty

	useEffect(() => {
		let saved: StoredProgress | null = null
		try {
			pruneProgress()
			saved = readProgress(storageKey)
			if (saved) {
				const [ingredients, steps] = JSON.parse(contentKey) as [
					string[],
					string[],
				]
				saved.ingredients = saved.ingredients.filter((t) =>
					ingredients.includes(t),
				)
				saved.steps = saved.steps.filter((t) => steps.includes(t))
				// Prune changed/removed content without extending the seven-day lifetime.
				writeProgress(storageKey, saved)
			}
		} catch {
			// Storage may be unavailable; checks still work for this mounted Recipe.
		}
		setProgress({
			contextKey,
			ingredients: new Set(saved?.ingredients),
			steps: new Set(saved?.steps),
			dirty: false,
		})
	}, [storageKey, contentKey, contextKey])

	useEffect(() => {
		if (progress.contextKey !== contextKey || !progress.dirty) return
		try {
			writeProgress(storageKey, {
				ingredients: [...progress.ingredients],
				steps: [...progress.steps],
				savedAt: Date.now(),
			})
			pruneProgress()
		} catch {
			// Full or blocked storage must not prevent checking or resetting locally.
		}
	}, [storageKey, contextKey, progress])

	function toggle(kind: 'ingredients' | 'steps', token: string | undefined) {
		if (!token) return
		setProgress((previous) => {
			const base = previous.contextKey === contextKey ? previous : empty
			const next = new Set(base[kind])
			if (next.has(token)) next.delete(token)
			else next.add(token)
			return { ...base, [kind]: next, dirty: true }
		})
	}

	return {
		checkedIngredients: new Set(
			[...ingredientTokens]
				.filter(([, t]) => current.ingredients.has(t))
				.map(([id]) => id),
		),
		checkedSteps: new Set(
			[...stepTokens].filter(([, t]) => current.steps.has(t)).map(([id]) => id),
		),
		toggleIngredient: (id: string) =>
			toggle('ingredients', ingredientTokens.get(id)),
		toggleStep: (id: string) => toggle('steps', stepTokens.get(id)),
		reset: () => setProgress({ ...empty, dirty: true }),
	}
}
