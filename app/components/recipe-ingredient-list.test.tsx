/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test, vi } from 'vitest'
import { IngredientList } from './recipe-ingredient-list.tsx'

const ingredients = [
	{
		id: 'rhubarb',
		name: 'rhubarb',
		amount: '500',
		unit: 'g',
		notes: null,
		isHeading: false,
	},
	{
		id: 'sugar',
		name: 'sugar',
		amount: '200',
		unit: 'g',
		notes: 'optional',
		isHeading: false,
	},
]

function renderList(props: { canAddToShopping?: boolean } = {}) {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<IngredientList
					ingredients={ingredients}
					checkedIngredients={new Set(['sugar'])}
					onToggle={vi.fn()}
					ratio={1}
					recipeId="tart"
					{...props}
				/>
			),
		},
	])
	render(<Stub />)
}

test('every unchecked ingredient offers Shopping, and nothing claims availability', () => {
	renderList()

	// No have/missing reading of the household's Staples (#289).
	expect(screen.queryByText(/You have/)).not.toBeInTheDocument()
	expect(
		screen.queryByRole('button', { name: 'Usually on hand' }),
	).not.toBeInTheDocument()
	expect(
		screen.getAllByRole('button', { name: 'Add to shopping list' }),
	).toHaveLength(1)
	expect(screen.getByRole('checkbox', { name: 'rhubarb' })).toBeVisible()
	expect(screen.getByRole('checkbox', { name: 'sugar' })).toBeVisible()
})

test('the anonymous share page offers no Shopping action', () => {
	renderList({ canAddToShopping: false })

	expect(
		screen.queryByRole('button', { name: 'Add to shopping list' }),
	).not.toBeInTheDocument()
	expect(screen.getByRole('checkbox', { name: 'rhubarb' })).toBeVisible()
})
