/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { RecipeMetadataCard } from './recipe-metadata-card.tsx'

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

test('can leave yield to the cooking scale control without duplicating it', () => {
	render(
		<RecipeMetadataCard
			activeTime={25}
			totalTime={null}
			yieldAmount={4}
			yieldLabel="dough balls"
			sourceUrl={null}
			showYield={false}
		/>,
	)

	expect(screen.getByText('Active: 25 min')).toBeVisible()
	expect(screen.queryByText(/dough balls/)).not.toBeInTheDocument()
})

test('adds no metadata row when Recipe time and yield are unknown', () => {
	const { container } = render(
		<RecipeMetadataCard
			activeTime={null}
			totalTime={null}
			yieldAmount={null}
			yieldLabel={null}
			sourceUrl={null}
		/>,
	)
	expect(container).toBeEmptyDOMElement()
})
