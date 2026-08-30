/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test, vi } from 'vitest'
import { IngredientList } from './recipe-ingredient-list.tsx'

test('Recipe ingredients omit the availability summary and bulk Shopping action', () => {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<IngredientList
					ingredients={[
						{
							id: 'rhubarb',
							name: 'rhubarb',
							amount: '500',
							unit: 'g',
							notes: null,
							isHeading: false,
						},
					]}
					checkedIngredients={new Set()}
					onToggle={vi.fn()}
					ratio={1}
					missingIngredientIds={['rhubarb']}
					recipeId="tart"
				/>
			),
		},
	])

	render(<Stub />)

	expect(screen.queryByText(/You have/)).not.toBeInTheDocument()
	expect(
		screen.queryByRole('button', { name: /Add 1 missing to Shopping List/ }),
	).not.toBeInTheDocument()
	expect(
		screen.getByRole('button', { name: 'Add to shopping list' }),
	).toBeVisible()
})
