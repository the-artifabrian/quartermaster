/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { MealQuantityReview } from './meal-quantity-review.tsx'

const proposal = {
	status: 'proposal' as const,
	assumptions: ['Several shared sides are served.'],
	items: [
		{
			itemKey: 'stew',
			scaleMultiplier: 2,
			scalingMode: 'flexible' as const,
			rationale: 'Enough stew for the table.',
			assumptions: ['Guests take one moderate bowl.'],
		},
		{
			itemKey: 'cake',
			scaleMultiplier: 1,
			scalingMode: 'fixed' as const,
			rationale: 'Keep one whole cake.',
			assumptions: [],
		},
	],
}

test('review exposes assumptions and lets each item be accepted, edited, or rejected before explicit apply', async () => {
	const user = userEvent.setup()
	const onApply = vi.fn()
	const onUpdateDefaults = vi.fn()
	render(
		<MealQuantityReview
			proposal={proposal}
			items={[
				{ itemKey: 'stew', title: 'Stew', currentScaleMultiplier: 1 },
				{ itemKey: 'cake', title: 'Orange cake', currentScaleMultiplier: 1 },
			]}
			busy={false}
			onApply={onApply}
			onUpdateDefaults={onUpdateDefaults}
			onRerun={vi.fn()}
			onCancel={vi.fn()}
		/>,
	)

	expect(screen.getByText('Several shared sides are served.')).toBeVisible()
	expect(screen.getByText('Guests take one moderate bowl.')).toBeVisible()
	expect(screen.getByText(/Keep one whole cake\./)).toBeVisible()

	await user.click(
		screen.getByRole('checkbox', {
			name: 'Use proposed quantity for Orange cake',
		}),
	)
	const stewInput = screen.getByLabelText('Multiplier', {
		selector: '#quantity-stew',
	})
	await user.clear(stewInput)
	await user.type(stewInput, '2,5')
	await user.click(screen.getByRole('button', { name: 'Apply selected' }))

	expect(onApply).toHaveBeenCalledWith([
		{ itemKey: 'stew', scaleMultiplier: 2.5 },
	])
	await user.click(screen.getByRole('button', { name: 'Update Menu defaults' }))
	expect(onUpdateDefaults).toHaveBeenCalledWith([
		{ itemKey: 'stew', scaleMultiplier: 2.5 },
	])
})

test('invalid selected edits cannot be applied while rejected items remain manual', async () => {
	const user = userEvent.setup()
	render(
		<MealQuantityReview
			proposal={proposal}
			items={[
				{ itemKey: 'stew', title: 'Stew', currentScaleMultiplier: 1 },
				{ itemKey: 'cake', title: 'Orange cake', currentScaleMultiplier: 1 },
			]}
			busy={false}
			onApply={vi.fn()}
			onRerun={vi.fn()}
			onCancel={vi.fn()}
		/>,
	)

	const stewInput = screen.getByLabelText('Multiplier', {
		selector: '#quantity-stew',
	})
	await user.clear(stewInput)
	await user.type(stewInput, '0')
	expect(screen.getByRole('button', { name: 'Apply selected' })).toBeDisabled()
	expect(screen.getByText('Use 0.01–100, up to two decimals')).toBeVisible()
})
