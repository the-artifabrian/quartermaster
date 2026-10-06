/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { ActiveStaples } from './active-staples.tsx'
import { SUGGESTED_STAPLES, StapleSuggestions } from './staple-suggestions.tsx'

// Failure list (#351):
// 1. a tap posts the page's add-staple intent with that name
// 2. a held name hides its suggestion, whatever its case and spacing
// 3. every suggestion held → no section at all
// 4. Staples present at load → no suggestions on the page
// 5. none at load, then one added → the row stays, minus the added one

function renderSuggestions(
	held: string[],
	action?: (formData: FormData) => void,
) {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<StapleSuggestions held={held} heading="No Staples yet" lead="Tap." />
			),
			action: async ({ request }) => {
				action?.(await request.formData())
				return { status: 'success' }
			},
		},
	])
	render(<Stub initialEntries={['/']} />)
}

test('a tap posts add-staple with the suggested name', async () => {
	const posted: Record<string, string>[] = []
	renderSuggestions([], (formData) =>
		posted.push(Object.fromEntries(formData) as Record<string, string>),
	)
	const list = screen.getByRole('list', { name: 'Suggested Staples' })
	expect(within(list).getAllByRole('button')).toHaveLength(
		SUGGESTED_STAPLES.length,
	)

	const oliveOil = screen.getByRole('button', { name: 'Add olive oil' })
	expect(oliveOil).toHaveTextContent(/^olive oil$/)
	await userEvent.click(oliveOil)

	await waitFor(() =>
		expect(posted).toEqual([
			{ intent: 'add-staple', displayName: 'olive oil' },
		]),
	)
})

test('a held name hides its suggestion regardless of case and spacing', () => {
	renderSuggestions(['Olive  OIL', ' Salt '])
	const list = screen.getByRole('list', { name: 'Suggested Staples' })
	expect(
		within(list).queryByRole('button', { name: 'Add olive oil' }),
	).toBeNull()
	expect(within(list).queryByRole('button', { name: 'Add salt' })).toBeNull()
	expect(within(list).getByRole('button', { name: 'Add garlic' })).toBeVisible()
})

test('nothing renders once every suggestion is held', () => {
	renderSuggestions([...SUGGESTED_STAPLES])
	expect(screen.queryByRole('list', { name: 'Suggested Staples' })).toBeNull()
	expect(screen.queryByRole('heading', { name: 'No Staples yet' })).toBeNull()
})

const staple = (id: string, displayName: string) => ({
	id,
	displayName,
	onShoppingList: false,
})

test('a household with Staples at load sees no suggestions', () => {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => <ActiveStaples staples={[staple('1', 'Coffee')]} />,
		},
	])
	render(<Stub initialEntries={['/']} />)
	expect(screen.getByRole('list', { name: 'Staples' })).toBeVisible()
	expect(screen.queryByRole('list', { name: 'Suggested Staples' })).toBeNull()
})

test('suggestions stay for the visit after the first add, minus the added one', async () => {
	function Page() {
		const [staples, setStaples] = useState<ReturnType<typeof staple>[]>([])
		return (
			<>
				<button type="button" onClick={() => setStaples([staple('1', 'salt')])}>
					simulate revalidation
				</button>
				<ActiveStaples staples={staples} />
			</>
		)
	}
	const Stub = createRoutesStub([{ path: '/', Component: Page }])
	render(<Stub initialEntries={['/']} />)
	expect(screen.getByRole('heading', { name: 'No Staples yet' })).toBeVisible()
	expect(screen.getByRole('button', { name: 'Add salt' })).toBeVisible()

	await userEvent.click(
		screen.getByRole('button', { name: 'simulate revalidation' }),
	)

	expect(screen.getByRole('list', { name: 'Staples' })).toBeVisible()
	expect(
		screen.getByRole('heading', { name: 'Others you might keep' }),
	).toBeVisible()
	const list = screen.getByRole('list', { name: 'Suggested Staples' })
	expect(within(list).queryByRole('button', { name: 'Add salt' })).toBeNull()
	expect(within(list).getByRole('button', { name: 'Add pepper' })).toBeVisible()
})
