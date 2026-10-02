/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { recipeMetadataNameKey } from '#app/utils/recipe-metadata.ts'
import {
	RecipeMetadataFields,
	type RecipeMetadataOption,
} from './recipe-metadata-fields.tsx'

function option(
	dimension: string,
	name: string,
	id = `${dimension}-${name.toLowerCase()}`,
): RecipeMetadataOption {
	return { id, dimension, name, nameKey: recipeMetadataNameKey(name) }
}

const options = [
	option('cuisine', 'Japanese'),
	option('season', 'Autumn'),
	option('course', 'Main'),
]

function renderFields(selectedValueIds: string[] = []) {
	render(
		<RecipeMetadataFields
			options={options}
			selectedValueIds={selectedValueIds}
		/>,
	)
}

function readSelection() {
	const input = document.querySelector<HTMLInputElement>(
		'input[name="recipeMetadata"]',
	)
	return JSON.parse(input?.value ?? '{}') as {
		selectedValueIds: string[]
		newValues: Record<string, string[]>
	}
}

function cuisineGroup() {
	return within(screen.getByRole('group', { name: 'Cuisine' }))
}

test('the Add chip opens a focused input in its own group', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))

	expect(
		cuisineGroup().getByRole('textbox', { name: 'Add cuisine' }),
	).toHaveFocus()
	expect(
		screen.queryByRole('button', { name: 'Add cuisine' }),
	).not.toBeInTheDocument()
	expect(screen.getByRole('button', { name: 'Add season' })).toBeVisible()
})

test('Enter adds a selected chip, reports it, and keeps the input open for the next one', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('  Levantine  {Enter}')

	expect(
		cuisineGroup().getByRole('button', { name: 'Levantine', pressed: true }),
	).toBeVisible()
	expect(readSelection().newValues.cuisine).toEqual(['Levantine'])
	const input = cuisineGroup().getByRole('textbox', { name: 'Add cuisine' })
	expect(input).toHaveValue('')
	expect(input).toHaveFocus()
})

test('a name that matches an existing option selects it instead of duplicating it', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('japanese{Enter}')

	expect(
		cuisineGroup().getAllByRole('button', { name: 'Japanese' }),
	).toHaveLength(1)
	expect(
		cuisineGroup().getByRole('button', { name: 'Japanese', pressed: true }),
	).toBeVisible()
	expect(readSelection()).toEqual({
		selectedValueIds: ['cuisine-japanese'],
		newValues: { cuisine: [], season: [], course: [] },
	})
})

test('adding the same new name twice makes one chip', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('Thai{Enter}')
	await user.keyboard('thai{Enter}')

	expect(cuisineGroup().getAllByRole('button', { name: 'Thai' })).toHaveLength(
		1,
	)
	expect(readSelection().newValues.cuisine).toEqual(['Thai'])
})

test('a name over 50 characters shows the error and keeps the input open with its text', async () => {
	const user = userEvent.setup()
	renderFields()
	const tooLong = 'x'.repeat(51)

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard(`${tooLong}{Enter}`)

	expect(screen.getByRole('alert')).toHaveTextContent(
		'Keep names to 50 characters or fewer',
	)
	expect(
		cuisineGroup().getByRole('textbox', { name: 'Add cuisine' }),
	).toHaveValue(tooLong)
	expect(
		cuisineGroup().queryByRole('button', { name: tooLong }),
	).not.toBeInTheDocument()
	expect(readSelection().newValues.cuisine).toEqual([])
})

test('Escape closes the input without adding and returns focus to the chip', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('Thai{Escape}')

	expect(
		cuisineGroup().queryByRole('textbox', { name: 'Add cuisine' }),
	).not.toBeInTheDocument()
	expect(
		cuisineGroup().queryByRole('button', { name: 'Thai' }),
	).not.toBeInTheDocument()
	expect(screen.getByRole('button', { name: 'Add cuisine' })).toHaveFocus()
})

test('Enter on an empty input just closes it', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('   {Enter}')

	expect(
		cuisineGroup().queryByRole('textbox', { name: 'Add cuisine' }),
	).not.toBeInTheDocument()
	expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	expect(screen.getByRole('button', { name: 'Add cuisine' })).toHaveFocus()
})

test('leaving the input with text commits it, and leaving it empty closes it', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('Thai')
	await user.click(document.body)

	expect(
		cuisineGroup().getByRole('button', { name: 'Thai', pressed: true }),
	).toBeVisible()
	expect(
		cuisineGroup().queryByRole('textbox', { name: 'Add cuisine' }),
	).not.toBeInTheDocument()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.click(document.body)

	expect(
		cuisineGroup().queryByRole('textbox', { name: 'Add cuisine' }),
	).not.toBeInTheDocument()
	expect(readSelection().newValues.cuisine).toEqual(['Thai'])
})

test('opening another group commits the pending name and moves the input there', async () => {
	const user = userEvent.setup()
	renderFields()

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('Thai')
	await user.click(screen.getByRole('button', { name: 'Add season' }))

	expect(
		cuisineGroup().getByRole('button', { name: 'Thai', pressed: true }),
	).toBeVisible()
	const seasonGroup = within(screen.getByRole('group', { name: 'Season' }))
	expect(seasonGroup.getByRole('textbox', { name: 'Add season' })).toHaveFocus()
	expect(
		cuisineGroup().queryByRole('textbox', { name: 'Add cuisine' }),
	).not.toBeInTheDocument()
})

test('deselecting a new chip drops it from the saved values but keeps it on screen', async () => {
	const user = userEvent.setup()
	renderFields(['course-main'])

	await user.click(screen.getByRole('button', { name: 'Add cuisine' }))
	await user.keyboard('Thai{Enter}')
	await user.click(cuisineGroup().getByRole('button', { name: 'Thai' }))

	expect(
		cuisineGroup().getByRole('button', { name: 'Thai', pressed: false }),
	).toBeVisible()
	expect(readSelection()).toEqual({
		selectedValueIds: ['course-main'],
		newValues: { cuisine: [], season: [], course: [] },
	})
})
