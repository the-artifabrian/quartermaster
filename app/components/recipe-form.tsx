import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { Img } from 'openimg/react'
import { useId, useState } from 'react'
import { Form, useActionData, useNavigation } from 'react-router'
import { RecipeSchema } from '#app/utils/recipe-validation.ts'
import { ErrorList, Field, TextareaField } from './forms.tsx'
import {
	IngredientFields,
	type IngredientFieldValue,
} from './ingredient-fields.tsx'
import {
	InstructionFields,
	type InstructionFieldValue,
} from './instruction-fields.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'

type RecipeFormProps = {
	recipe?: {
		id: string
		title: string
		description?: string | null
		servings: number
		prepTime?: number | null
		cookTime?: number | null
		sourceUrl?: string | null
		notes?: string | null
		image?: { objectKey: string; altText?: string | null } | null
		ingredients: Array<{
			id: string
			name: string
			amount?: string | null
			unit?: string | null
			notes?: string | null
			isHeading?: boolean
			linkedRecipeId?: string | null
			linkedRecipeTitle?: string | null
		}>
		instructions: Array<{
			id: string
			content: string
		}>
	}
	submitLabel?: string
}

function FormSection({
	title,
	summary,
	defaultOpen,
	children,
}: {
	title: string
	summary?: string
	defaultOpen?: boolean
	children: React.ReactNode
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen ?? false)
	return (
		<details
			open={isOpen}
			onToggle={(e) => setIsOpen(e.currentTarget.open)}
			className="group/section rounded-xl border [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
		>
			<summary className="flex cursor-pointer items-center gap-2 p-4 select-none">
				<Icon
					name="chevron-down"
					size="sm"
					className="text-muted-foreground transition-transform group-not-open/section:-rotate-90"
				/>
				<h3 className="text-lg font-semibold">{title}</h3>
				{summary && (
					<span className="text-muted-foreground text-sm">{summary}</span>
				)}
			</summary>
			<div className="px-4 pb-4">{children}</div>
		</details>
	)
}

export function RecipeForm({
	recipe,
	submitLabel = 'Save Recipe',
}: RecipeFormProps) {
	const actionData = useActionData<{
		result: { error?: Record<string, string[]> }
	}>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	const formId = useId()
	const isEditing = !!recipe

	const [ingredients, setIngredients] = useState<IngredientFieldValue[]>(
		recipe?.ingredients?.map((i) => ({
			id: i.id,
			name: i.name,
			amount: i.amount ?? '',
			unit: i.unit ?? '',
			notes: i.notes ?? '',
			isHeading: i.isHeading ?? false,
			linkedRecipeId: i.linkedRecipeId ?? undefined,
			linkedRecipeTitle: i.linkedRecipeTitle ?? undefined,
		})) ?? [{ name: '', amount: '', unit: '', notes: '' }],
	)

	const [instructions, setInstructions] = useState<InstructionFieldValue[]>(
		recipe?.instructions?.map((i) => ({
			id: i.id,
			content: i.content,
		})) ?? [{ content: '' }],
	)

	const [imagePreview, setImagePreview] = useState<string | null>(
		recipe?.image?.objectKey
			? `/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`
			: null,
	)

	const [form, fields] = useForm({
		id: formId,
		constraint: getZodConstraint(RecipeSchema),
		lastResult: actionData?.result as any,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: RecipeSchema })
		},
		defaultValue: {
			title: recipe?.title ?? '',
			description: recipe?.description ?? '',
			servings: recipe?.servings ?? 4,
			prepTime: recipe?.prepTime ?? undefined,
			cookTime: recipe?.cookTime ?? undefined,
			sourceUrl: recipe?.sourceUrl ?? '',
			notes: recipe?.notes ?? '',
		},
		shouldRevalidate: 'onBlur',
		shouldValidate: 'onSubmit',
	})

	const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) {
			const reader = new FileReader()
			reader.onload = (event) => {
				setImagePreview(event.target?.result as string)
			}
			reader.readAsDataURL(file)
		}
	}

	// Section summaries for collapsed state
	const filledDetails = [
		fields.title.value ? 'title' : null,
		fields.description.value ? 'description' : null,
		fields.sourceUrl.value ? 'URL' : null,
		fields.notes.value ? 'notes' : null,
		fields.prepTime.value ? 'prep' : null,
		fields.cookTime.value ? 'cook' : null,
	].filter(Boolean).length

	return (
		<Form
			method="POST"
			encType="multipart/form-data"
			{...getFormProps(form)}
			className="space-y-4"
		>
			{/* Form-level errors */}
			{form.errors && form.errors.length > 0 && (
				<div className="border-destructive bg-destructive/10 rounded-lg border p-4">
					<h3 className="text-destructive mb-2 font-semibold">
						Please fix the following errors:
					</h3>
					<ErrorList errors={form.errors} id={form.errorId} />
				</div>
			)}

			{/* Photo Section */}
			<FormSection
				title="Photo"
				summary={imagePreview ? 'Has photo' : 'No photo'}
				defaultOpen={false}
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
					<div className="border-border/60 bg-muted/30 relative aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-dashed sm:w-40">
						{imagePreview ? (
							<Img
								src={imagePreview}
								alt="Recipe preview"
								className="h-full w-full object-cover"
								width={160}
								height={120}
							/>
						) : (
							<div className="flex h-full w-full items-center justify-center">
								<Icon name="camera" className="text-muted-foreground size-8" />
							</div>
						)}
					</div>
					<div className="space-y-2">
						<Input
							type="file"
							name="image"
							accept="image/jpeg,image/png,image/webp"
							onChange={handleImageChange}
							className="max-w-full text-sm"
						/>
						<p className="text-muted-foreground text-xs">
							JPG, PNG or WebP. Max 3MB.
						</p>
					</div>
				</div>
			</FormSection>

			{/* Details Section */}
			<FormSection
				title="Details"
				summary={`${filledDetails}/6 filled`}
				defaultOpen
			>
				<div className="space-y-4">
					<Field
						labelProps={{ children: 'Title' }}
						inputProps={{
							...getInputProps(fields.title, { type: 'text' }),
							placeholder: 'Recipe title',
						}}
						errors={fields.title.errors}
					/>

					<TextareaField
						labelProps={{ children: 'Description' }}
						textareaProps={{
							...getInputProps(fields.description, { type: 'text' }),
							placeholder: 'A brief description of this recipe',
							rows: 3,
						}}
						errors={fields.description.errors}
					/>

					<Field
						labelProps={{ children: 'Source URL' }}
						inputProps={{
							...getInputProps(fields.sourceUrl, { type: 'url' }),
							placeholder: 'https://example.com/recipe',
						}}
						errors={fields.sourceUrl.errors}
					/>

					<TextareaField
						labelProps={{ children: 'My Notes' }}
						textareaProps={{
							...getInputProps(fields.notes, { type: 'text' }),
							placeholder: 'Personal reminders, tips, or modifications...',
							rows: 3,
						}}
						errors={fields.notes.errors}
					/>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Field
							labelProps={{ children: 'Servings' }}
							inputProps={{
								...getInputProps(fields.servings, { type: 'number' }),
								min: 1,
								max: 100,
							}}
							errors={fields.servings.errors}
						/>
						<Field
							labelProps={{ children: 'Prep Time (min)' }}
							inputProps={{
								...getInputProps(fields.prepTime, { type: 'number' }),
								min: 0,
								placeholder: '—',
							}}
							errors={fields.prepTime.errors}
						/>
						<Field
							labelProps={{ children: 'Cook Time (min)' }}
							inputProps={{
								...getInputProps(fields.cookTime, { type: 'number' }),
								min: 0,
								placeholder: '—',
							}}
							errors={fields.cookTime.errors}
						/>
					</div>
				</div>
			</FormSection>

			{/* Ingredients Section */}
			<FormSection
				title="Ingredients"
				summary={(() => {
					const count = ingredients.filter((i) => i.name).length
					if (count === 0) return undefined
					return `${count} ${count === 1 ? 'item' : 'items'}`
				})()}
				defaultOpen={isEditing || ingredients.length <= 1}
			>
				<IngredientFields
					ingredients={ingredients}
					onChange={setIngredients}
					excludeRecipeId={recipe?.id}
				/>
			</FormSection>
			{/* Hidden inputs for ingredients */}
			{ingredients.map((ingredient, index) => (
				<div key={ingredient.id ?? index}>
					{ingredient.id && (
						<input
							type="hidden"
							name={`ingredients[${index}].id`}
							value={ingredient.id}
						/>
					)}
					<input
						type="hidden"
						name={`ingredients[${index}].name`}
						value={ingredient.name}
					/>
					<input
						type="hidden"
						name={`ingredients[${index}].amount`}
						value={ingredient.amount ?? ''}
					/>
					<input
						type="hidden"
						name={`ingredients[${index}].unit`}
						value={ingredient.unit ?? ''}
					/>
					<input
						type="hidden"
						name={`ingredients[${index}].notes`}
						value={ingredient.notes ?? ''}
					/>
					<input
						type="hidden"
						name={`ingredients[${index}].isHeading`}
						value={ingredient.isHeading ? 'true' : ''}
					/>
					{ingredient.linkedRecipeId && (
						<input
							type="hidden"
							name={`ingredients[${index}].linkedRecipeId`}
							value={ingredient.linkedRecipeId}
						/>
					)}
				</div>
			))}

			{/* Instructions Section */}
			<FormSection
				title="Instructions"
				summary={(() => {
					const count = instructions.filter((i) => i.content).length
					if (count === 0) return undefined
					return `${count} ${count === 1 ? 'step' : 'steps'}`
				})()}
				defaultOpen={isEditing || instructions.length <= 1}
			>
				<InstructionFields
					instructions={instructions}
					onChange={setInstructions}
				/>
			</FormSection>
			{/* Hidden inputs for instructions */}
			{instructions.map((instruction, index) => (
				<div key={instruction.id ?? index}>
					{instruction.id && (
						<input
							type="hidden"
							name={`instructions[${index}].id`}
							value={instruction.id}
						/>
					)}
					<input
						type="hidden"
						name={`instructions[${index}].content`}
						value={instruction.content}
					/>
				</div>
			))}

			<div className="bg-background/95 supports-[backdrop-filter]:backdrop-blur-sm sticky bottom-16 z-10 flex justify-end gap-4 border-t py-3 md:static md:bottom-auto md:z-auto md:bg-transparent md:pt-6 md:pb-0 md:backdrop-blur-none">
				<Button type="button" variant="outline" onClick={() => history.back()}>
					Cancel
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
