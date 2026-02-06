import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Form, data, redirect } from 'react-router'
import { Field, CheckboxField } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	InventoryItemSchema,
	LOCATION_LABELS,
} from '#app/utils/inventory-validation.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Add Inventory Item | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return {}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()

	const submission = parseWithZod(formData, { schema: InventoryItemSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	await prisma.inventoryItem.create({
		data: {
			...submission.value,
			userId,
		},
	})

	return redirect(`/inventory`)
}

export default function NewInventoryItem() {
	const [form, fields] = useForm({
		id: 'new-inventory-item',
		defaultValue: {
			lowStock: false,
		},
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: InventoryItemSchema })
		},
		shouldValidate: 'onBlur',
		shouldRevalidate: 'onInput',
	})

	return (
		<div className="container max-w-2xl py-6 pb-20 md:pb-6">
			<div className="mb-6 flex items-center gap-2">
				<Button variant="ghost" size="sm" asChild>
					<a href="/inventory">
						<Icon name="arrow-left" size="sm" />
					</a>
				</Button>
				<h1 className="text-2xl font-bold">Add Inventory Item</h1>
			</div>

			<Form method="POST" {...getFormProps(form)}>
				<div className="space-y-4">
					<Field
						labelProps={{ children: 'Item Name' }}
						inputProps={{
							...getInputProps(fields.name, { type: 'text' }),
							placeholder: 'e.g., Chicken breast, Milk, Flour',
							autoComplete: 'off',
						}}
						errors={fields.name.errors}
					/>

					<div>
						<Label htmlFor="location">Location</Label>
						<select
							{...getInputProps(fields.location, { type: 'text' })}
							defaultValue="pantry"
							className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
						>
							<option value="pantry">{LOCATION_LABELS.pantry}</option>
							<option value="fridge">{LOCATION_LABELS.fridge}</option>
							<option value="freezer">{LOCATION_LABELS.freezer}</option>
						</select>
						<div className="min-h-[32px] px-4 pt-1 pb-3">
							{fields.location.errors && (
								<p className="text-destructive text-sm">
									{fields.location.errors}
								</p>
							)}
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<Field
							labelProps={{ children: 'Quantity (optional)' }}
							inputProps={{
								...getInputProps(fields.quantity, { type: 'number' }),
								placeholder: 'e.g., 2.5',
								step: '0.1',
							}}
							errors={fields.quantity.errors}
						/>

						<Field
							labelProps={{ children: 'Unit (optional)' }}
							inputProps={{
								...getInputProps(fields.unit, { type: 'text' }),
								placeholder: 'e.g., lbs, cups, count',
								autoComplete: 'off',
							}}
							errors={fields.unit.errors}
						/>
					</div>

					<Field
						labelProps={{ children: 'Expiration Date (optional)' }}
						inputProps={{
							...getInputProps(fields.expiresAt, { type: 'date' }),
						}}
						errors={fields.expiresAt.errors}
					/>

					<CheckboxField
						labelProps={{ children: 'Mark as low stock' }}
						buttonProps={{
							...getInputProps(fields.lowStock, { type: 'checkbox' }),
							form: form.id,
							defaultChecked: false,
						}}
						errors={fields.lowStock.errors}
					/>

					<div className="flex gap-4 pt-4">
						<StatusButton
							type="submit"
							status="idle"
							className="flex-1"
							disabled={!form.valid}
						>
							Add Item
						</StatusButton>
						<Button type="button" variant="outline" asChild>
							<a href="/inventory">Cancel</a>
						</Button>
					</div>
				</div>
			</Form>
		</div>
	)
}
