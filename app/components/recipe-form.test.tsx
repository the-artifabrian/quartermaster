/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test, vi } from 'vitest'
import { RECIPE_FORM_ID, RecipeForm } from './recipe-form.tsx'

test('Recipe form reopens explicit time and typed yield values for editing', () => {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<RecipeForm
					recipe={{
						id: 'recipe-1',
						title: 'Braided loaf',
						activeTime: 25,
						totalTime: 180,
						yieldAmount: 2.5,
						yieldLabel: 'large braided loaves',
						ingredients: [{ id: 'ingredient-1', name: 'flour' }],
						instructions: [{ id: 'instruction-1', content: 'Knead.' }],
					}}
				/>
			),
		},
	])
	render(<Stub />)
	fireEvent.click(screen.getByText('Details', { exact: true }))

	expect(
		screen.getByRole('spinbutton', { name: 'Active time (min)' }),
	).toHaveValue(25)
	expect(
		screen.getByRole('spinbutton', { name: 'Total time (min)' }),
	).toHaveValue(180)
	expect(
		screen.getByRole('spinbutton', { name: 'Amount this Recipe makes' }),
	).toHaveValue(2.5)
	expect(
		screen.getByRole('combobox', { name: 'What this Recipe makes' }),
	).toHaveValue('large braided loaves')
})

test('invalid optional details reopen and focus the field before saving', async () => {
	const user = userEvent.setup()
	const save = vi.fn(() => null)
	const Stub = createRoutesStub([
		{
			path: '/',
			action: save,
			// Save lives in the nav bar, outside the form, as in the app.
			Component: () => (
				<>
					<button type="submit" form={RECIPE_FORM_ID}>
						Save
					</button>
					<RecipeForm />
				</>
			),
		},
	])
	render(<Stub />)
	await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Pasta')
	await user.type(screen.getByPlaceholderText('Ingredient name'), 'pasta')
	await user.type(screen.getByPlaceholderText('Step 1'), 'Boil.')
	const details = screen.getByText('Details', { exact: true })
	await user.click(details)
	const source = screen.getByRole('textbox', { name: 'Source URL' })
	await user.type(source, 'not a URL')
	await user.click(details)
	expect(source).not.toBeVisible()
	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(source).toBeVisible())
	expect(source).toHaveFocus()
	expect(source).toHaveAttribute('aria-invalid', 'true')
	expect(save).not.toHaveBeenCalled()
	await user.clear(source)
	await user.type(source, 'https://example.test/pasta')
	await user.click(details)
	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(save).toHaveBeenCalledOnce())
})

// Failure list for the photo after a Save the server refused because of it:
// - a file it can't use or that is too big comes off the input, and the
//   preview goes back to none, so the next Save goes through without it
// - so does one the upload parser stopped at for size, whose reply has no
//   reason
// - a photo the server had no turn to check stays, with its preview, so
//   the next Save tries it again instead of saving without it
/** Picks a photo, saves, and waits for the server's refusal of it. */
async function saveRefusedPhoto(photoRefusal: string | undefined) {
	const user = userEvent.setup()
	const Stub = createRoutesStub([
		{
			path: '/',
			action: () => ({
				result: {
					status: 'error',
					initialValue: {},
					error: { image: ['That photo didn’t go through.'] },
				},
				photoRefusal,
			}),
			Component: () => (
				<>
					<button type="submit" form={RECIPE_FORM_ID}>
						Save
					</button>
					<RecipeForm />
				</>
			),
		},
	])
	const { container } = render(<Stub />)
	await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Pasta')
	await user.type(screen.getByPlaceholderText('Ingredient name'), 'pasta')
	await user.type(screen.getByPlaceholderText('Step 1'), 'Boil.')
	const input = container.querySelector<HTMLInputElement>(
		'input[type="file"][name="image"]',
	)!
	await user.upload(
		input,
		new File(['jpeg bytes'], 'pasta.jpg', { type: 'image/jpeg' }),
	)
	await screen.findByRole('img', { name: 'Recipe preview' })
	await user.click(screen.getByRole('button', { name: 'Save' }))
	await screen.findByText('That photo didn’t go through.')
	return input
}

test.each([
	['it can’t use', 'unusable'],
	['that is too big', 'too-big'],
	['the upload parser stopped at for size', undefined],
])('clears a photo the server refused as one %s', async (_, photoRefusal) => {
	const input = await saveRefusedPhoto(photoRefusal)
	await waitFor(() => expect(input.files).toHaveLength(0))
	expect(screen.queryByRole('img', { name: 'Recipe preview' })).toBeNull()
})

test('keeps a photo the server had no turn to check', async () => {
	const input = await saveRefusedPhoto('busy')
	expect(input.files).toHaveLength(1)
	expect(
		screen.getByRole('img', { name: 'Recipe preview' }),
	).toBeInTheDocument()
})
