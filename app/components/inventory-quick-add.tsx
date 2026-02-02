import { Form } from 'react-router'
import { useState } from 'react'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'
import { Icon } from './ui/icon.tsx'

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
			className="flex gap-2"
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
				className="flex-1"
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
