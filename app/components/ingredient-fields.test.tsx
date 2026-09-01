/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import {
	IngredientFields,
	type IngredientFieldValue,
} from './ingredient-fields.tsx'

function Harness({ initial }: { initial: IngredientFieldValue[] }) {
	const [ingredients, setIngredients] = useState(initial)
	const [, setRevision] = useState(0)
	return (
		<>
			<button type="button" onClick={() => setRevision((value) => value + 1)}>
				Rerender
			</button>
			<IngredientFields ingredients={ingredients} onChange={setIngredients} />
			<output data-testid="state">{JSON.stringify(ingredients)}</output>
		</>
	)
}

function renderFields(initial: IngredientFieldValue[]) {
	const Stub = createRoutesStub([
		{ path: '/', Component: () => <Harness initial={initial} /> },
	])
	render(<Stub initialEntries={['/']} />)
}

function getState(): IngredientFieldValue[] {
	return JSON.parse(
		screen.getByTestId('state').textContent ?? '[]',
	) as IngredientFieldValue[]
}

test('keeps an initial row mounted through unrelated parent renders', async () => {
	const user = userEvent.setup()
	renderFields([{ name: '', amount: '', unit: '', notes: '' }])
	const initialInput = screen.getByPlaceholderText('Ingredient name')

	await user.click(screen.getByRole('button', { name: 'Rerender' }))

	expect(screen.getByPlaceholderText('Ingredient name')).toBe(initialInput)
})

test('keeps an initially empty row expanded while its name is typed', async () => {
	const user = userEvent.setup()
	renderFields([{ name: '', amount: '', unit: '', notes: '' }])

	await user.type(screen.getByPlaceholderText('Ingredient name'), 'spaghetti')

	expect(screen.getByPlaceholderText('Ingredient name')).toHaveValue(
		'spaghetti',
	)
	expect(screen.getByPlaceholderText('Amount')).toBeVisible()
})

test('convert to heading drops fields, converting back restores them', async () => {
	const user = userEvent.setup()
	renderFields([
		{
			name: 'flour',
			amount: '1',
			unit: 'cup',
			notes: 'sifted',
			linkedRecipeId: 'r1',
			linkedRecipeTitle: 'Pie dough',
			sortKey: 'k1',
		},
		{ name: 'salt', sortKey: 'k2' },
	])

	// Expand the collapsed row, then convert it to a heading
	await user.click(screen.getByText('1 cup flour, sifted'))
	await user.click(
		screen.getByRole('button', { name: 'Convert to section heading' }),
	)

	let state = getState()
	expect(state[0]).toMatchObject({ name: 'flour', isHeading: true })
	expect(state[0]!.amount).toBeUndefined()
	expect(state[0]!.linkedRecipeId).toBeUndefined()

	// Converting back restores everything the heading couldn't carry
	await user.click(
		screen.getByRole('button', { name: 'Convert to regular ingredient' }),
	)

	state = getState()
	expect(state[0]).toMatchObject({
		name: 'flour',
		amount: '1',
		unit: 'cup',
		notes: 'sifted',
		linkedRecipeId: 'r1',
		linkedRecipeTitle: 'Pie dough',
		isHeading: false,
	})
})

test('headings created via Add Heading convert to empty ingredients', async () => {
	const user = userEvent.setup()
	renderFields([
		{ name: 'Sauce', isHeading: true, sortKey: 'k1' },
		{ name: 'salt', sortKey: 'k2' },
	])

	await user.click(
		screen.getByRole('button', { name: 'Convert to regular ingredient' }),
	)

	const state = getState()
	expect(state[0]).toMatchObject({ name: 'Sauce', isHeading: false })
	expect(state[0]!.amount).toBeUndefined()
})
