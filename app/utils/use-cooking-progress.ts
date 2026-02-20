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
	const saved = useRef<StoredProgress | null>(undefined as never)
	if (saved.current === (undefined as never)) {
		saved.current = loadProgress(recipeId)
	}

	const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
		() => (saved.current ? new Set(saved.current.ingredients) : new Set()),
	)
	const [checkedSteps, setCheckedSteps] = useState<Set<string>>(() =>
		saved.current ? new Set(saved.current.steps) : new Set(),
	)

	// Skip the initial mount write — only persist actual user changes
	const isInitial = useRef(true)
	useEffect(() => {
		if (isInitial.current) {
			isInitial.current = false
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
