/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test, vi } from 'vitest'
import { EnhanceRecipeModal } from './enhance-recipe-modal.tsx'

test('reviews and applies estimated Recipe times with the description', async () => {
	const user = userEvent.setup()
	const onClose = vi.fn()
	let submitted: Record<string, FormDataEntryValue> | null = null
	const recipe = {
		id: 'recipe-1',
		description: null,
		activeTime: null,
		totalTime: null,
	}
	const suggestions = {
		description: 'Creamy chickpeas warmed with care.',
		activeTime: 10,
		totalTime: 25,
	}
	const Stub = createRoutesStub([
		{
			path: '/recipes/:recipeId',
			Component: () => (
				<EnhanceRecipeModal
					open
					recipe={recipe}
					suggestions={suggestions}
					onClose={onClose}
				/>
			),
			action: async ({ request }) => {
				submitted = Object.fromEntries(await request.formData())
				return { success: true }
			},
		},
	])

	render(<Stub initialEntries={['/recipes/recipe-1']} />)

	expect(screen.getByText('Active time')).toBeVisible()
	expect(screen.getByText('Total time')).toBeVisible()
	expect(screen.getByText('10 min')).toBeVisible()
	expect(screen.getByText('25 min')).toBeVisible()

	await user.click(screen.getByRole('button', { name: 'Apply selected' }))
	await waitFor(() =>
		expect(submitted).toEqual({
			intent: 'applyEnhancement',
			enhance_description: 'Creamy chickpeas warmed with care.',
			enhance_activeTime: '10',
			enhance_totalTime: '25',
		}),
	)
})

test('requires a compatible selection when one estimate conflicts with saved time', async () => {
	const user = userEvent.setup()
	let submitted: Record<string, FormDataEntryValue> | null = null
	const Stub = createRoutesStub([
		{
			path: '/recipes/:recipeId',
			Component: () => (
				<EnhanceRecipeModal
					open
					recipe={{
						id: 'recipe-1',
						description: null,
						activeTime: null,
						totalTime: 20,
					}}
					suggestions={{
						description: null,
						activeTime: 30,
						totalTime: 60,
					}}
					onClose={vi.fn()}
				/>
			),
			action: async ({ request }) => {
				submitted = Object.fromEntries(await request.formData())
				return { success: true }
			},
		},
	])

	render(<Stub initialEntries={['/recipes/recipe-1']} />)

	const applyButton = screen.getByRole('button', { name: 'Apply selected' })
	expect(applyButton).toBeDisabled()
	expect(
		screen.getByText(
			'Total time can’t be shorter than active time. Untick one of them.',
		),
	).toBeVisible()

	await user.click(screen.getByRole('checkbox', { name: /Total time/ }))
	expect(applyButton).toBeEnabled()
	await user.click(applyButton)

	await waitFor(() =>
		expect(submitted).toEqual({
			intent: 'applyEnhancement',
			enhance_activeTime: '30',
			enhance_totalTime: '60',
		}),
	)
})

test('the review stays as it was while the sheet leaves after Apply', async () => {
	const user = userEvent.setup()
	const suggestions = {
		description: 'Creamy chickpeas warmed with care.',
		activeTime: 10,
		totalTime: 25,
	}
	function Page() {
		const [recipe, setRecipe] = useState({
			id: 'recipe-1',
			description: null as string | null,
			activeTime: null as number | null,
			totalTime: null as number | null,
		})
		return (
			<EnhanceRecipeModal
				open
				recipe={recipe}
				suggestions={suggestions}
				// The Recipe page revalidates with the applied values as it closes.
				onClose={() => setRecipe({ id: 'recipe-1', ...suggestions })}
			/>
		)
	}
	const Stub = createRoutesStub([
		{
			path: '/recipes/:recipeId',
			Component: Page,
			action: () => ({ success: true }),
		},
	])

	render(<Stub initialEntries={['/recipes/recipe-1']} />)
	await user.click(screen.getByRole('button', { name: 'Apply selected' }))

	await waitFor(() =>
		expect(
			screen.getByRole('button', { name: 'Apply selected' }),
		).toBeEnabled(),
	)
	expect(screen.queryByText(/Nothing to suggest/)).toBeNull()
	expect(screen.getByText('Total time')).toBeVisible()
})

test('closes once the suggestions are applied', async () => {
	const user = userEvent.setup()
	const onClose = vi.fn()
	const Stub = createRoutesStub([
		{
			path: '/recipes/:recipeId',
			Component: () => (
				<EnhanceRecipeModal
					open
					recipe={{
						id: 'recipe-1',
						description: null,
						activeTime: null,
						totalTime: null,
					}}
					suggestions={{
						description: 'Creamy chickpeas warmed with care.',
						activeTime: 10,
						totalTime: 25,
					}}
					onClose={onClose}
				/>
			),
			action: () => ({ success: true }),
		},
	])

	render(<Stub initialEntries={['/recipes/recipe-1']} />)
	expect(onClose).not.toHaveBeenCalled()
	await user.click(screen.getByRole('button', { name: 'Apply selected' }))

	await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})
