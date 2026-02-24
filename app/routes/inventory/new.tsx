import {
	getFormProps,
	getInputProps,
	getSelectProps,
	useForm,
	type Submission,
} from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Form, data, redirect, useActionData } from 'react-router'
import { Field, CheckboxField } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { findMatchingInventoryItem } from '#app/utils/inventory-dedup.server.ts'
import {
	InventoryItemSchema,
	LOCATION_LABELS,
} from '#app/utils/inventory-validation.ts'
import {
	getInventoryUsage,
	getUserTier,
} from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/new.ts'

type DuplicateWarning = {
	existingId: string
	existingName: string
	existingLocation: string
}

type ActionData = {
	result: Submission<unknown>['reply'] extends (...args: any[]) => infer R
		? R
		: never
	duplicateWarning?: DuplicateWarning
}

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Add Inventory Item | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { isProActive } = await getUserTier(userId)
	const usage = await getInventoryUsage(householdId, isProActive)
	if (usage.isAtLimit) {
		throw await redirectWithToast('/inventory', {
			type: 'message',
			title: 'Free plan limit reached',
			description: `You can have up to ${usage.limit} items on the free plan. Upgrade to Pro for unlimited inventory.`,
		})
	}
	return {}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { isProActive } = await getUserTier(userId)
	const usage = await getInventoryUsage(householdId, isProActive)
	if (usage.isAtLimit) {
		throw await redirectWithToast('/inventory', {
			type: 'message',
			title: 'Free plan limit reached',
			description: `You can have up to ${usage.limit} items on the free plan.`,
		})
	}
	const formData = await request.formData()

	const submission = parseWithZod(formData, { schema: InventoryItemSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const force = formData.get('force')

	// Check for duplicates unless force is set
	if (!force) {
		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId, location: submission.value.location },
		})
		const match = findMatchingInventoryItem(
			submission.value.name,
			submission.value.location,
			existingItems,
		)
		if (match) {
			return data({
				result: submission.reply(),
				duplicateWarning: {
					existingId: match.id,
					existingName: match.name,
					existingLocation: match.location,
				},
			})
		}
	}

	if (force === 'merge') {
		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId, location: submission.value.location },
		})
		const match = findMatchingInventoryItem(
			submission.value.name,
			submission.value.location,
			existingItems,
		)
		if (match) {
			const newExpiry = submission.value.expiresAt
			const updateData: Record<string, unknown> = { lowStock: false }
			if (
				newExpiry &&
				(!match.expiresAt ||
					newExpiry.getTime() > match.expiresAt.getTime())
			) {
				updateData.expiresAt = newExpiry
			}
			await prisma.inventoryItem.update({
				where: { id: match.id },
				data: updateData,
			})
			return redirectWithToast('/inventory', {
				type: 'success',
				description: `Updated existing ${match.name}`,
			})
		}
	}

	// force === 'add' or no duplicate found — create normally
	await prisma.inventoryItem.create({
		data: {
			...submission.value,
			userId,
			householdId,
		},
	})

	void emitHouseholdEvent({
		type: 'inventory_item_added',
		payload: {
			name: submission.value.name,
			location: submission.value.location,
		},
		userId,
		householdId,
	})

	return redirect(`/inventory`)
}

export default function NewInventoryItem() {
	const rawActionData = useActionData<typeof action>()
	const actionData = rawActionData as ActionData | undefined
	const duplicateWarning = actionData?.duplicateWarning ?? null

	const [form, fields] = useForm({
		id: 'new-inventory-item',
		lastResult: actionData?.result,
		defaultValue: {
			location: 'pantry',
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

			{duplicateWarning && (
				<div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/40">
					<p className="text-sm text-amber-800 dark:text-amber-300">
						You already have <strong>{duplicateWarning.existingName}</strong> in
						the {duplicateWarning.existingLocation}.
					</p>
					<div className="mt-3 flex gap-2">
						<Form method="POST">
							{/* Re-send all form values with force=merge */}
							<input
								type="hidden"
								name="name"
								value={fields.name.value ?? ''}
							/>
							<input
								type="hidden"
								name="location"
								value={fields.location.value ?? ''}
							/>
							<input
								type="hidden"
								name="expiresAt"
								value={fields.expiresAt.value ?? ''}
							/>
							<input
								type="hidden"
								name="lowStock"
								value={fields.lowStock.value ?? ''}
							/>
							<input type="hidden" name="force" value="merge" />
							<Button
								type="submit"
								size="sm"
								variant="outline"
								className="border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
							>
								Update existing
							</Button>
						</Form>
						<Form method="POST">
							<input
								type="hidden"
								name="name"
								value={fields.name.value ?? ''}
							/>
							<input
								type="hidden"
								name="location"
								value={fields.location.value ?? ''}
							/>
							<input
								type="hidden"
								name="expiresAt"
								value={fields.expiresAt.value ?? ''}
							/>
							<input
								type="hidden"
								name="lowStock"
								value={fields.lowStock.value ?? ''}
							/>
							<input type="hidden" name="force" value="add" />
							<Button
								type="submit"
								size="sm"
								variant="ghost"
								className="text-amber-700 dark:text-amber-400"
							>
								Add anyway
							</Button>
						</Form>
					</div>
				</div>
			)}

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
						<Label htmlFor={fields.location.id}>Location</Label>
						<select
							{...getSelectProps(fields.location)}
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
