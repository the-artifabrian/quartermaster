import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { useId } from 'react'
import { Form, Link, useActionData, useNavigation } from 'react-router'
import { MenuSchema } from '#app/utils/menu-validation.ts'
import { ErrorList, Field, TextareaField } from './forms.tsx'
import { Button } from './ui/button.tsx'
import { StatusButton } from './ui/status-button.tsx'

type MenuFormProps = {
	menu?: {
		id: string
		title: string
		description?: string | null
		defaultGuestCount?: number | null
	}
	submitLabel?: string
}

export function MenuForm({ menu, submitLabel = 'Save Menu' }: MenuFormProps) {
	const actionData = useActionData<{
		result: { error?: Record<string, string[]> }
	}>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	const formId = useId()

	const [form, fields] = useForm({
		id: formId,
		constraint: getZodConstraint(MenuSchema),
		lastResult: actionData?.result as any,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: MenuSchema })
		},
		defaultValue: {
			title: menu?.title ?? '',
			description: menu?.description ?? '',
			defaultGuestCount: menu?.defaultGuestCount?.toString() ?? '',
		},
		shouldRevalidate: 'onBlur',
		shouldValidate: 'onSubmit',
	})

	return (
		<Form method="POST" {...getFormProps(form)} className="space-y-4">
			{/* Form-level errors */}
			{form.errors && form.errors.length > 0 && (
				<div className="border-destructive bg-destructive/10 rounded-lg border p-4">
					<ErrorList errors={form.errors} id={form.errorId} />
				</div>
			)}

			<Field
				labelProps={{ children: 'Title' }}
				inputProps={{
					...getInputProps(fields.title, { type: 'text' }),
					placeholder: 'e.g. Terrace dinner',
					autoFocus: !menu,
				}}
				errors={fields.title.errors}
			/>

			<TextareaField
				labelProps={{ children: 'Description' }}
				textareaProps={{
					...getInputProps(fields.description, { type: 'text' }),
					placeholder: 'The occasion or intent, so future you remembers',
					rows: 3,
				}}
				errors={fields.description.errors}
			/>

			<Field
				className="max-w-48"
				labelProps={{ children: 'Default guests' }}
				inputProps={{
					...getInputProps(fields.defaultGuestCount, { type: 'number' }),
					min: 1,
					max: 999,
					inputMode: 'numeric',
					placeholder: '—',
				}}
				errors={fields.defaultGuestCount.errors}
			/>

			<div className="flex items-center justify-end gap-3 pt-2">
				<Button asChild variant="ghost">
					<Link to={menu ? `/recipes/menus/${menu.id}` : '/recipes/menus'}>
						Cancel
					</Link>
				</Button>
				<StatusButton
					type="submit"
					status={isSubmitting ? 'pending' : 'idle'}
					disabled={isSubmitting}
				>
					{submitLabel}
				</StatusButton>
			</div>
		</Form>
	)
}
