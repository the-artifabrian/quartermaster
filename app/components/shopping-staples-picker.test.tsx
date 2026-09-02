/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { ShoppingStaplesPicker } from './shopping-staples-picker.tsx'

test('selects available Staples in one batch and quietly dismisses the empty-list cue', async () => {
	const submissions: Array<Record<string, FormDataEntryValue>> = []
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<ShoppingStaplesPicker
					staples={[
						{ id: 'milk', displayName: 'Milk', onShoppingList: false },
						{ id: 'yogurt', displayName: 'Yogurt', onShoppingList: false },
						{ id: 'salt', displayName: 'Salt', onShoppingList: true },
					]}
					showQuietCue
				/>
			),
			action: async ({ request }) => {
				const submitted = Object.fromEntries(await request.formData())
				submissions.push(submitted)
				return { status: 'success', addedCount: 2, moveItemIds: [] }
			},
		},
	])
	const user = userEvent.setup()
	render(<Stub initialEntries={['/']} />)

	await user.click(
		screen.getByRole('button', {
			name: 'From Staples, reminder available',
		}),
	)
	expect(screen.getByRole('button', { name: 'From Staples' })).toBeVisible()
	expect(
		screen.getByRole('heading', { name: 'What do you need this trip?' }),
	).toBeVisible()
	expect(screen.getByRole('button', { name: /Salt.*On list/ })).toBeDisabled()

	await user.click(screen.getByRole('button', { name: 'Milk' }))
	await user.click(screen.getByRole('button', { name: 'Yogurt' }))
	await user.click(screen.getByRole('button', { name: 'Add 2 to Next shop' }))

	await waitFor(() =>
		expect(submissions).toContainEqual({
			intent: 'bulk-add',
			horizon: 'next',
			items: JSON.stringify([{ name: 'Milk' }, { name: 'Yogurt' }]),
		}),
	)
	await waitFor(() =>
		expect(
			screen.queryByRole('heading', { name: 'What do you need this trip?' }),
		).not.toBeInTheDocument(),
	)
})
