/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { MenuForm } from './menu-form.tsx'

test('Menu editing shows target yield for known Recipes and multiplier for unknown Recipes', () => {
	const recipes = [
		{
			id: 'known',
			title: 'Pepper parcels',
			prepTime: null,
			cookTime: null,
			yieldAmount: 12,
			yieldLabel: 'pieces',
			isFavorite: false,
			image: null,
		},
		{
			id: 'unknown',
			title: 'Family stew',
			prepTime: null,
			cookTime: null,
			yieldAmount: null,
			yieldLabel: null,
			isFavorite: false,
			image: null,
		},
	]
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<MenuForm
					menu={{ id: 'menu', title: 'Canonical Dinner' }}
					builder={{
						recipes,
						sections: [
							{
								id: 'section',
								name: null,
								items: [
									{
										id: 'known-item',
										kind: 'recipe',
										recipeId: 'known',
										recipeTitle: 'Pepper parcels',
										scaleMultiplier: 1.5,
										note: null,
									},
									{
										id: 'unknown-item',
										kind: 'recipe',
										recipeId: 'unknown',
										recipeTitle: 'Family stew',
										scaleMultiplier: 2.5,
										note: null,
									},
								],
							},
						],
					}}
				/>
			),
		},
	])
	render(<Stub />)

	expect(
		screen.getByRole('textbox', {
			name: 'Target pieces for Pepper parcels',
		}),
	).toHaveValue('18')
	expect(
		screen.getByRole('textbox', {
			name: 'Scale multiplier for Family stew',
		}),
	).toHaveValue('2.5')
	expect(
		screen.queryByText(/servings/i, { selector: 'label, span' }),
	).not.toBeInTheDocument()
})
