/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { RecipeFacts, RecipeMetadataCard } from './recipe-metadata-card.tsx'

test('shows explicit Recipe time and a custom typed yield', () => {
	render(
		<RecipeMetadataCard
			activeTime={25}
			totalTime={180}
			yieldAmount={2.5}
			yieldLabel="large braided loaves for a celebration table"
			sourceUrl={null}
		/>,
	)

	expect(screen.getByText('Active: 25 min')).toBeVisible()
	expect(screen.getByText('Total: 3 hr')).toBeVisible()
	expect(
		screen.getByText('Makes 2.5 large braided loaves for a celebration table'),
	).toBeVisible()
})

test('the facts show only what the Recipe has, each label over its value', () => {
	render(
		<RecipeFacts
			activeTime={null}
			totalTime={90}
			yieldAmount={null}
			yieldLabel={null}
			scaleMultiplier={1}
			sourceUrl={null}
		/>,
	)

	expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
		'Total',
	])
	expect(screen.getByRole('definition')).toHaveTextContent('1 hr 30 min')
})

test('a Recipe with no times, no yield and no source draws no facts at all', () => {
	const { container } = render(
		<RecipeFacts
			activeTime={null}
			totalTime={null}
			yieldAmount={null}
			yieldLabel={null}
			scaleMultiplier={1}
			sourceUrl={null}
		/>,
	)

	expect(container).toBeEmptyDOMElement()
})

test('the yield follows the scale, in the scale control’s words', () => {
	const { rerender } = render(
		<RecipeFacts
			activeTime={null}
			totalTime={null}
			yieldAmount={1}
			yieldLabel="loaf"
			scaleMultiplier={2}
			sourceUrl={null}
		/>,
	)

	expect(screen.getByRole('term')).toHaveTextContent('Makes')
	expect(screen.getByRole('definition')).toHaveTextContent('2 loaves')

	rerender(
		<RecipeFacts
			activeTime={null}
			totalTime={null}
			yieldAmount={1}
			yieldLabel="loaf"
			scaleMultiplier={1}
			sourceUrl="https://www.example.com/bread"
		/>,
	)
	expect(screen.getByRole('definition')).toHaveTextContent('1 loaf')
	expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute(
		'href',
		'https://www.example.com/bread',
	)
})
