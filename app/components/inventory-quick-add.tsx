import { useState } from 'react'
import { Form } from 'react-router'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'

type InventoryQuickAddProps = {
	location: 'pantry' | 'fridge' | 'freezer'
}

export function InventoryQuickAdd({ location }: InventoryQuickAddProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [name, setName] = useState('')

	if (!isOpen) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => setIsOpen(true)}
				className="w-full"
			>
				<Icon name="plus" size="sm" />
				Quick Add
			</Button>
		)
	}

	return (
		<Form
			method="POST"
			className="flex flex-wrap gap-2"
			onSubmit={(e) => {
				const formData = new FormData(e.currentTarget)
				if (!formData.get('name')) {
					e.preventDefault()
					return
				}
				setName('')
				setIsOpen(false)
			}}
		>
			<input type="hidden" name="intent" value="create" />
			<input type="hidden" name="location" value={location} />
			<Input
				name="name"
				placeholder="Item name..."
				value={name}
				onChange={(e) => setName(e.target.value)}
				autoFocus
				className="min-w-[120px] flex-1"
			/>
			<Input
				name="quantity"
				type="number"
				step="0.1"
				min="0"
				placeholder="Qty"
				className="w-20 min-w-0 shrink"
			/>
			<Input
				name="unit"
				placeholder="Unit"
				className="w-24 min-w-0 shrink"
			/>
			<StatusButton
				type="submit"
				size="sm"
				status="idle"
				disabled={!name.trim()}
			>
				Add
			</StatusButton>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				aria-label="Close quick add"
				onClick={() => {
					setIsOpen(false)
					setName('')
				}}
			>
				<Icon name="cross-1" size="sm" />
			</Button>
		</Form>
	)
}
