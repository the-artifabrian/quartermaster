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
import { Label } from './ui/label.tsx'
import { StatusButton } from './ui/status-button.tsx'

type Tag = {
	id: string
	name: string
	category: string
}

type RecipeFormProps = {
	recipe?: {
		id: string
		title: string
		description?: string | null
		servings: number
		prepTime?: number | null
		cookTime?: number | null
		image?: { objectKey: string; altText?: string | null } | null
		ingredients: Array<{
			id: string
			name: string
			amount?: string | null
			unit?: string | null
			notes?: string | null
		}>
		instructions: Array<{
			id: string
			content: string
		}>
		tags: Array<{ id: string }>
	}
	tags: Tag[]
	submitLabel?: string
}

export function RecipeForm({
	recipe,
	tags,
	submitLabel = 'Save Recipe',
}: RecipeFormProps) {
	const actionData = useActionData<{ result: { error?: Record<string, string[]> } }>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	const formId = useId()

	const [ingredients, setIngredients] = useState<IngredientFieldValue[]>(
		recipe?.ingredients?.map((i) => ({
			id: i.id,
			name: i.name,
			amount: i.amount ?? '',
			unit: i.unit ?? '',
			notes: i.notes ?? '',
		})) ?? [{ name: '', amount: '', unit: '', notes: '' }],
	)

	const [instructions, setInstructions] = useState<InstructionFieldValue[]>(
		recipe?.instructions?.map((i) => ({
			id: i.id,
			content: i.content,
		})) ?? [{ content: '' }],
	)

	const [selectedTags, setSelectedTags] = useState<string[]>(
		recipe?.tags?.map((t) => t.id) ?? [],
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

	const tagsByCategory = tags.reduce<Record<string, Tag[]>>(
		(acc, tag) => {
			const category = acc[tag.category]
			if (!category) {
				acc[tag.category] = [tag]
			} else {
				category.push(tag)
			}
			return acc
		},
		{},
	)

	const categoryLabels: Record<string, string> = {
		cuisine: 'Cuisine',
		'meal-type': 'Meal Type',
		dietary: 'Dietary',
	}

	return (
		<Form
			method="POST"
			encType="multipart/form-data"
			{...getFormProps(form)}
			className="space-y-8"
		>
			{/* Form-level errors */}
			{form.errors && form.errors.length > 0 && (
				<div className="rounded-lg border border-destructive bg-destructive/10 p-4">
					<h3 className="font-semibold text-destructive mb-2">Please fix the following errors:</h3>
					<ErrorList errors={form.errors} id={form.errorId} />
				</div>
			)}

			{/* Image Upload */}
			<div className="space-y-2">
				<Label>Recipe Image</Label>
				<div className="flex items-start gap-4">
					<div className="relative aspect-[4/3] w-40 overflow-hidden rounded-lg border bg-muted">
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
								<Icon name="camera" className="size-8 text-muted-foreground" />
							</div>
						)}
					</div>
					<div className="space-y-2">
						<Input
							type="file"
							name="image"
							accept="image/jpeg,image/png,image/webp"
							onChange={handleImageChange}
							className="w-auto"
						/>
						<p className="text-xs text-muted-foreground">
							JPG, PNG or WebP. Max 3MB.
						</p>
					</div>
				</div>
			</div>

			{/* Basic Info */}
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

				<div className="grid grid-cols-3 gap-4">
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

			{/* Tags */}
			<div className="space-y-4">
				<Label className="text-base font-semibold">Tags</Label>
				{Object.entries(tagsByCategory).map(([category, categoryTags]) => (
					<div key={category} className="space-y-2">
						<Label className="text-sm text-muted-foreground">
							{categoryLabels[category] ?? category}
						</Label>
						<div className="flex flex-wrap gap-2">
							{categoryTags.map((tag) => {
								const isSelected = selectedTags.includes(tag.id)
								return (
									<label key={tag.id}>
										<input
											type="checkbox"
											name="tagIds"
											value={tag.id}
											checked={isSelected}
											onChange={(e) => {
												if (e.target.checked) {
													setSelectedTags([...selectedTags, tag.id])
												} else {
													setSelectedTags(
														selectedTags.filter((id) => id !== tag.id),
													)
												}
											}}
											className="sr-only"
										/>
										<span
											className={`inline-flex cursor-pointer rounded-full px-3 py-1 text-sm transition-colors ${
												isSelected
													? 'bg-primary text-primary-foreground'
													: 'bg-secondary hover:bg-secondary/80'
											}`}
										>
											{tag.name}
										</span>
									</label>
								)
							})}
						</div>
					</div>
				))}
			</div>

			{/* Ingredients */}
			<IngredientFields
				ingredients={ingredients}
				onChange={setIngredients}
			/>
			{/* Hidden inputs for ingredients */}
			{ingredients.map((ingredient, index) => (
				<div key={ingredient.id ?? index}>
					{ingredient.id && (
						<input type="hidden" name={`ingredients[${index}].id`} value={ingredient.id} />
					)}
					<input type="hidden" name={`ingredients[${index}].name`} value={ingredient.name} />
					<input type="hidden" name={`ingredients[${index}].amount`} value={ingredient.amount ?? ''} />
					<input type="hidden" name={`ingredients[${index}].unit`} value={ingredient.unit ?? ''} />
					<input type="hidden" name={`ingredients[${index}].notes`} value={ingredient.notes ?? ''} />
				</div>
			))}

			{/* Instructions */}
			<InstructionFields
				instructions={instructions}
				onChange={setInstructions}
			/>
			{/* Hidden inputs for instructions */}
			{instructions.map((instruction, index) => (
				<div key={instruction.id ?? index}>
					{instruction.id && (
						<input type="hidden" name={`instructions[${index}].id`} value={instruction.id} />
					)}
					<input type="hidden" name={`instructions[${index}].content`} value={instruction.content} />
				</div>
			))}

			<div className="flex justify-end gap-4">
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
