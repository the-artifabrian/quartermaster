import { useState, useCallback, useRef, useEffect } from 'react'

const STORAGE_KEY_PREFIX = 'cooking-progress:'
const EXPIRY_DAYS = 7
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000

type StoredProgress = {
	ingredients: string[]
	steps: string[]
	savedAt: number
}

function getStorageKey(recipeId: string) {
	return `${STORAGE_KEY_PREFIX}${recipeId}`
}

function loadProgress(recipeId: string): StoredProgress | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = localStorage.getItem(getStorageKey(recipeId))
		if (!raw) return null
		const parsed = JSON.parse(raw) as StoredProgress
		if (Date.now() - parsed.savedAt > EXPIRY_MS) {
			localStorage.removeItem(getStorageKey(recipeId))
			return null
		}
		return parsed
	} catch {
		return null
	}
}

function saveProgress(
	recipeId: string,
	ingredients: Set<string>,
	steps: Set<string>,
) {
	try {
		if (ingredients.size === 0 && steps.size === 0) {
			localStorage.removeItem(getStorageKey(recipeId))
			return
		}
		const data: StoredProgress = {
			ingredients: [...ingredients],
			steps: [...steps],
			savedAt: Date.now(),
		}
		localStorage.setItem(getStorageKey(recipeId), JSON.stringify(data))
	} catch {
		// localStorage full or unavailable — silently ignore
	}
}

export function useCookingProgress(recipeId: string) {
	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => new Set(),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(
		() => new Set(),
	)

	// 0 = waiting for hydrate, 1 = hydrated (skip save), 2 = normal
	const hydratePhase = useRef(0)

	// Load from localStorage after mount (avoids SSR mismatch)
	useEffect(() => {
		const saved = loadProgress(recipeId)
		if (saved) {
			hydratePhase.current = 1
			setCheckedIngredients(new Set(saved.ingredients))
			setCheckedSteps(new Set(saved.steps))
		} else {
			hydratePhase.current = 2
		}
	}, [recipeId])

	// Persist changes to localStorage (skip the hydrate-triggered update)
	useEffect(() => {
		if (hydratePhase.current === 0) return
		if (hydratePhase.current === 1) {
			hydratePhase.current = 2
			return
		}
		saveProgress(recipeId, checkedIngredients, checkedSteps)
	}, [recipeId, checkedIngredients, checkedSteps])

	const toggleIngredient = useCallback((id: string) => {
		setCheckedIngredients((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}, [])

	const toggleStep = useCallback((id: string) => {
		setCheckedSteps((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}, [])

	const clearProgress = useCallback(() => {
		setCheckedIngredients(new Set())
		setCheckedSteps(new Set())
		try {
			localStorage.removeItem(getStorageKey(recipeId))
		} catch {
			// ignore
		}
	}, [recipeId])

	return {
		checkedIngredients,
		checkedSteps,
		toggleIngredient,
		toggleStep,
		clearProgress,
	}
}
