/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { ActiveStaples } from './staples-cutover.tsx'

test('users can search household Staples and reach every management control', async () => {
	const submissions: Array<Record<string, FormDataEntryValue>> = []
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<ActiveStaples
					staples={[
						{ id: 'salt', displayName: 'Salt', isOut: false },
						{ id: 'rice', displayName: 'Brown rice', isOut: true },
					]}
					archivedInventoryCount={3}
				/>
			),
			action: async ({ request }) => {
				const submitted = Object.fromEntries(await request.formData())
				submissions.push(submitted)
				return { status: 'success', action: submitted.intent }
			},
		},
	])
	render(<Stub initialEntries={['/']} />)
	const user = userEvent.setup()

	expect(screen.getByRole('textbox', { name: 'Add a Staple' })).toBeVisible()
	expect(
		screen.getByRole('searchbox', { name: 'Search Staples' }),
	).toBeVisible()
	expect(screen.getByRole('button', { name: 'Mark Salt Out' })).toBeVisible()
	expect(screen.getByRole('button', { name: 'Remove Salt' })).toBeVisible()

	await user.type(
		screen.getByRole('textbox', { name: 'Add a Staple' }),
		'Garlic',
	)
	await user.click(screen.getByRole('button', { name: 'Add' }))
	await waitFor(() =>
		expect(submissions).toContainEqual({
			intent: 'add-staple',
			displayName: 'Garlic',
		}),
	)

	await user.click(screen.getByRole('button', { name: 'Mark Salt Out' }))
	await waitFor(() =>
		expect(submissions).toContainEqual({
			intent: 'toggle-staple-out',
			itemId: 'salt',
		}),
	)

	await user.click(screen.getByRole('button', { name: 'Remove Salt' }))
	await user.click(screen.getByRole('button', { name: 'Confirm remove Salt' }))
	await waitFor(() =>
		expect(submissions).toContainEqual({
			intent: 'remove-staple',
			itemId: 'salt',
		}),
	)

	await user.type(
		screen.getByRole('searchbox', { name: 'Search Staples' }),
		'rice',
	)
	expect(screen.queryByText('Salt')).not.toBeInTheDocument()
	expect(screen.getByText('Brown rice')).toBeVisible()
	expect(
		screen.getByRole('button', { name: 'Mark Brown rice not Out' }),
	).toBeVisible()
	expect(
		screen.getByRole('button', { name: 'Remove Brown rice' }),
	).toBeVisible()
})
