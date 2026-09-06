// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import { useCookingProgress } from './use-cooking-progress.ts'

const context = {
	userId: 'user-a',
	householdId: 'household-a',
	recipeId: 'recipe-a',
	ingredients: [
		{
			id: 'ingredient',
			name: 'rice',
			amount: '100',
			unit: 'g',
			notes: null,
			isHeading: false,
			linkedRecipeId: null,
		},
	],
	instructions: [{ id: 'step', content: 'Boil for 10 minutes.' }],
}
const key = 'cooking-progress:v2:["user-a","household-a","recipe-a"]'
const day = 24 * 60 * 60 * 1000
const wrapper = ({ children }: { children: ReactNode }) => (
	<StrictMode>{children}</StrictMode>
)

test('hydrates in StrictMode without extending expiry; reset persists', () => {
	localStorage.clear()
	const now = Date.now()
	vi.spyOn(Date, 'now').mockReturnValue(now)
	const first = renderHook(() => useCookingProgress(context), { wrapper })
	act(() => {
		first.result.current.toggleIngredient('ingredient')
		first.result.current.toggleStep('step')
	})
	const saved = localStorage.getItem(key)
	first.unmount()
	vi.mocked(Date.now).mockReturnValue(now + day)
	const next = renderHook(() => useCookingProgress(context), { wrapper })
	expect(next.result.current.checkedIngredients.has('ingredient')).toBe(true)
	expect(next.result.current.checkedSteps.has('step')).toBe(true)
	expect(localStorage.getItem(key)).toBe(saved)
	act(() => next.result.current.reset())
	expect(next.result.current.checkedSteps.size).toBe(0)
	expect(next.result.current.checkedIngredients.size).toBe(0)
	expect(localStorage.getItem(key)).toBeNull()
	next.unmount()
	expect(
		renderHook(() => useCookingProgress(context)).result.current.checkedSteps
			.size,
	).toBe(0)
})

test.each(['recipeId', 'userId', 'householdId'] as const)(
	'switching %s never renders or saves old checks in the next context',
	(field) => {
		localStorage.clear()
		const renders: number[] = []
		const hook = renderHook(
			(props) => {
				const result = useCookingProgress(props)
				renders.push(result.checkedSteps.size)
				return result
			},
			{ initialProps: context, wrapper },
		)
		act(() => hook.result.current.toggleStep('step'))
		const saved = localStorage.getItem(key)
		renders.length = 0
		hook.rerender({ ...context, [field]: 'other' })
		expect(renders.every((count) => count === 0)).toBe(true)
		expect(Object.keys(localStorage)).toEqual([key])
		expect(localStorage.getItem(key)).toBe(saved)
		act(() => hook.result.current.toggleIngredient('ingredient'))
		hook.rerender(context)
		expect(hook.result.current.checkedSteps.has('step')).toBe(true)
		expect(hook.result.current.checkedIngredients.size).toBe(0)
	},
)

test('changed content and removed IDs lose checks; unchanged rows retain checks', () => {
	localStorage.clear()
	const hook = renderHook((props) => useCookingProgress(props), {
		initialProps: context,
	})
	act(() => {
		hook.result.current.toggleIngredient('ingredient')
		hook.result.current.toggleStep('step')
	})
	hook.rerender({
		...context,
		instructions: [{ id: 'step', content: 'Bake for 30 minutes.' }],
	})
	expect(hook.result.current.checkedSteps.size).toBe(0)
	expect(hook.result.current.checkedIngredients.has('ingredient')).toBe(true)
	hook.rerender(context)
	expect(hook.result.current.checkedSteps.size).toBe(0)
	hook.rerender({
		...context,
		ingredients: [{ ...context.ingredients[0]!, amount: '200' }],
	})
	expect(hook.result.current.checkedIngredients.size).toBe(0)
	act(() => hook.result.current.toggleStep('step'))
	hook.rerender({ ...context, instructions: [] })
	expect(hook.result.current.checkedSteps.size).toBe(0)
	hook.rerender(context)
	expect(hook.result.current.checkedSteps.size).toBe(0)
})

test.each([
	'broken JSON',
	'null',
	'{"ingredients":{},"steps":[]}',
	JSON.stringify({ ingredients: [], steps: [1], savedAt: Date.now() }),
	JSON.stringify({ ingredients: [], steps: [], savedAt: Date.now() + day }),
	JSON.stringify({ ingredients: [], steps: [], savedAt: Date.now() - 7 * day }),
])('discards invalid or expired storage: %s', (stored) => {
	localStorage.clear()
	localStorage.setItem(key, stored)
	expect(
		renderHook(() => useCookingProgress(context)).result.current.checkedSteps
			.size,
	).toBe(0)
	expect(localStorage.getItem(key)).toBeNull()
})

test('ignores unscoped legacy progress and prunes expired records on other Recipes', () => {
	localStorage.clear()
	localStorage.setItem(
		'cooking-progress:recipe-a',
		JSON.stringify({
			ingredients: ['ingredient'],
			steps: ['step'],
			savedAt: Date.now(),
		}),
	)
	localStorage.setItem(
		'cooking-progress:v2:expired',
		JSON.stringify({
			ingredients: [],
			steps: [],
			savedAt: Date.now() - 8 * day,
		}),
	)
	const { result } = renderHook(() => useCookingProgress(context))
	expect(result.current.checkedSteps.size).toBe(0)
	expect(result.current.checkedIngredients.size).toBe(0)
	expect(localStorage.getItem('cooking-progress:v2:expired')).toBeNull()
})

test('bounds retained Recipes and keeps the newest active checks', () => {
	localStorage.clear()
	for (let i = 0; i < 55; i++)
		localStorage.setItem(
			`cooking-progress:v2:${i}`,
			JSON.stringify({
				ingredients: [],
				steps: ['test'],
				savedAt: Date.now() - (i + 1) * 1000,
			}),
		)
	const { result } = renderHook(() => useCookingProgress(context))
	act(() => result.current.toggleStep('step'))
	expect(Object.keys(localStorage)).toHaveLength(50)
	expect(localStorage.getItem('cooking-progress:v2:54')).toBeNull()
	expect(localStorage.getItem(key)).not.toBeNull()
})

test.each(['getItem', 'setItem', 'removeItem'] as const)(
	'checks and reset still work when storage %s throws',
	(method) => {
		localStorage.clear()
		vi.spyOn(Storage.prototype, method).mockImplementation(() => {
			throw new Error('Storage unavailable')
		})
		const { result } = renderHook(() => useCookingProgress(context))
		act(() => {
			result.current.toggleIngredient('ingredient')
			result.current.toggleStep('step')
		})
		expect(result.current.checkedSteps.has('step')).toBe(true)
		expect(result.current.checkedIngredients.has('ingredient')).toBe(true)
		act(() => result.current.reset())
		expect(result.current.checkedSteps.size).toBe(0)
		expect(result.current.checkedIngredients.size).toBe(0)
	},
)

test.each([7 * day - 1, 7 * day, 7 * day + 1])(
	'checked content expires exactly seven days after interaction (age %s ms)',
	(age) => {
		localStorage.clear()
		const now = Date.now()
		vi.spyOn(Date, 'now').mockReturnValue(now)
		localStorage.setItem(
			key,
			JSON.stringify({
				ingredients: [],
				steps: [JSON.stringify(['step', context.instructions[0]!.content])],
				savedAt: now - age,
			}),
		)
		const { result } = renderHook(() => useCookingProgress(context))
		expect(result.current.checkedSteps.has('step')).toBe(age < 7 * day)
		expect(localStorage.getItem(key) !== null).toBe(age < 7 * day)
	},
)
