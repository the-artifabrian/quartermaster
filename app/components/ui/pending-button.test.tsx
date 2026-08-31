/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PendingButton } from './pending-button.tsx'

afterEach(() => {
	vi.useRealTimers()
})

test('locks immediately and delays visible pending feedback', async () => {
	vi.useFakeTimers()
	const { rerender } = render(
		<PendingButton pending={false} pendingLabel="Generating shopping list">
			From Plan
		</PendingButton>,
	)
	rerender(
		<PendingButton pending pendingLabel="Generating shopping list">
			From Plan
		</PendingButton>,
	)

	const button = screen.getByRole('button', { name: /from plan/i })
	expect(button).toBeDisabled()
	expect(button).toHaveAttribute('aria-busy', 'true')
	expect(screen.queryByRole('status')).not.toBeInTheDocument()

	await act(() => vi.advanceTimersByTimeAsync(399))
	expect(screen.queryByRole('status')).not.toBeInTheDocument()

	await act(() => vi.advanceTimersByTimeAsync(1))
	const status = screen.getByRole('status')
	expect(status).toBeVisible()
	expect(status).toHaveTextContent('Generating shopping list')
	expect(screen.getByText('From Plan')).toBeInTheDocument()
})

test('stays enabled and has no busy semantics while idle', () => {
	render(
		<PendingButton pending={false} pendingLabel="Clearing checked items">
			Clear checked
		</PendingButton>,
	)

	const button = screen.getByRole('button', { name: /clear checked/i })
	expect(button).toBeEnabled()
	expect(button).not.toHaveAttribute('aria-busy')
	expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
