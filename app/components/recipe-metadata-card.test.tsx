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
		screen.getByText('Yield: 2.5 large braided loaves for a celebration table'),
	).toBeVisible()
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
