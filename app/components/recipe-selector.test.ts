import { expect, test } from 'vitest'
import { getRecipeTotalTime } from './recipe-selector.tsx'

test('compact Recipe choices use explicit Total time and keep unknown time unknown', () => {
	expect(getRecipeTotalTime({ totalTime: 35 })).toBe(35)
	expect(getRecipeTotalTime({ totalTime: null })).toBeNull()
})
