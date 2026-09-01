/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test } from 'vitest'
import {
	InstructionFields,
	type InstructionFieldValue,
} from './instruction-fields.tsx'

function Harness({ initial }: { initial: InstructionFieldValue[] }) {
	const [instructions, setInstructions] = useState(initial)
	const [, setRevision] = useState(0)
	return (
		<>
			<button type="button" onClick={() => setRevision((value) => value + 1)}>
				Rerender
			</button>
			<InstructionFields
				instructions={instructions}
				onChange={setInstructions}
			/>
		</>
	)
}

test('keeps an initial row mounted through unrelated parent renders', async () => {
	const user = userEvent.setup()
	render(<Harness initial={[{ content: '' }]} />)
	const initialInput = screen.getByPlaceholderText('Step 1')

	await user.click(screen.getByRole('button', { name: 'Rerender' }))

	expect(screen.getByPlaceholderText('Step 1')).toBe(initialInput)
})
