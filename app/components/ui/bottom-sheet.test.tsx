/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { BottomSheet } from './bottom-sheet.tsx'

// jsdom runs no CSS transitions. A sheet that is closing waits for its
// animations, so the tests hand it one that finishes when they say so.
function holdExitAnimations() {
	let finish = () => {}
	const finished = new Promise<void>((resolve) => {
		finish = resolve
	})
	Element.prototype.getAnimations = () =>
		[{ finished }] as unknown as Animation[]
	return {
		async end() {
			finish()
			await act(async () => {
				await finished
			})
		},
		[Symbol.dispose]() {
			delete (Element.prototype as Partial<Element>).getAnimations
		},
	}
}

function Sheet({ name, onClose }: { name: string; onClose?: () => void }) {
	const [open, setOpen] = useState(false)
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open {name}
			</button>
			<BottomSheet
				open={open}
				onClose={() => {
					onClose?.()
					setOpen(false)
				}}
				labelledBy={`${name}-title`}
				title={name}
			>
				<input aria-label={`${name} field`} />
			</BottomSheet>
		</>
	)
}

test('backdrop tap, Escape and the close button each close the sheet once', async () => {
	const user = userEvent.setup()
	const onClose = vi.fn()
	render(<Sheet name="Add" onClose={onClose} />)

	await user.click(screen.getByRole('button', { name: 'Open Add' }))
	await user.click(
		document.querySelector<HTMLElement>('[data-bottom-sheet-backdrop]')!,
	)
	expect(onClose).toHaveBeenCalledTimes(1)
	expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

	await user.click(screen.getByRole('button', { name: 'Open Add' }))
	await user.keyboard('{Escape}')
	expect(onClose).toHaveBeenCalledTimes(2)
	expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

	await user.click(screen.getByRole('button', { name: 'Open Add' }))
	await user.click(screen.getByRole('button', { name: 'Close' }))
	expect(onClose).toHaveBeenCalledTimes(3)
	expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a closing sheet stays in place until its exit ends, then gives focus back to its trigger', async () => {
	const user = userEvent.setup()
	render(<Sheet name="Add" />)
	const trigger = screen.getByRole('button', { name: 'Open Add' })

	await user.click(trigger)
	const dialog = screen.getByRole('dialog', { name: 'Add' })
	expect(dialog).toHaveAttribute('data-state', 'open')
	expect(dialog).toContainElement(document.activeElement as HTMLElement)

	using exit = holdExitAnimations()
	await user.keyboard('{Escape}')
	expect(dialog).toBeInTheDocument()
	expect(dialog).toHaveAttribute('data-state', 'closed')
	expect(trigger).not.toHaveFocus()

	await exit.end()
	expect(dialog).not.toBeInTheDocument()
	expect(trigger).toHaveFocus()
})

test('opening a sheet again while it leaves keeps it open', async () => {
	const user = userEvent.setup()
	render(<Sheet name="Add" />)
	await user.click(screen.getByRole('button', { name: 'Open Add' }))
	await user.type(screen.getByRole('textbox', { name: 'Add field' }), 'milk')

	using exit = holdExitAnimations()
	await user.keyboard('{Escape}')
	await user.click(screen.getByRole('button', { name: 'Open Add' }))
	await exit.end()

	const dialog = screen.getByRole('dialog', { name: 'Add' })
	expect(dialog).toHaveAttribute('data-state', 'open')
	expect(screen.getByRole('textbox', { name: 'Add field' })).toHaveValue('milk')
})

test('two sheets are never open at once', async () => {
	const user = userEvent.setup()
	const onCloseFirst = vi.fn()
	render(
		<>
			<Sheet name="First" onClose={onCloseFirst} />
			<Sheet name="Second" />
		</>,
	)

	await user.click(screen.getByRole('button', { name: 'Open First' }))
	// A test reaches the other trigger through the backdrop; a person can
	// reach it while the first sheet leaves, or from a keyboard shortcut.
	await act(async () => {
		screen.getByRole('button', { name: 'Open Second' }).click()
	})

	expect(onCloseFirst).toHaveBeenCalledTimes(1)
	expect(screen.queryByRole('dialog', { name: 'First' })).toBeNull()
	expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
})

test('Escape closes only the open sheet, not one that is still leaving', async () => {
	const user = userEvent.setup()
	const onCloseFirst = vi.fn()
	const onCloseSecond = vi.fn()
	render(
		<>
			<Sheet name="First" onClose={onCloseFirst} />
			<Sheet name="Second" onClose={onCloseSecond} />
		</>,
	)

	await user.click(screen.getByRole('button', { name: 'Open First' }))
	using exit = holdExitAnimations()
	await user.keyboard('{Escape}')
	await act(async () => {
		screen.getByRole('button', { name: 'Open Second' }).click()
	})
	await user.keyboard('{Escape}')
	await exit.end()

	expect(onCloseFirst).toHaveBeenCalledTimes(1)
	expect(onCloseSecond).toHaveBeenCalledTimes(1)
	expect(screen.queryByRole('dialog')).toBeNull()
})
