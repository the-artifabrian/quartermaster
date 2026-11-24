import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { createId } from '@paralleldrive/cuid2'
import { Img } from 'openimg/react'
import { useEffect, useId, useRef, useState } from 'react'
import { Form, useActionData } from 'react-router'
import { toast } from 'sonner'
import { useFitFileInput } from '#app/utils/downscale-image.ts'
import { isEditScreenDone } from '#app/utils/edit-screen.ts'
import { IMG_SIZES } from '#app/utils/image-route.ts'
import { listErrors } from '#app/utils/list-errors.ts'
import { CREATED_IDS_FIELD, loadedIdsValue } from '#app/utils/loaded-rows.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { getHistoryLog, resolveAfterSave } from '#app/utils/nav-back.ts'
import { historyIndex } from '#app/utils/nav-direction.ts'
import { haptic } from '#app/utils/shell-bridge.ts'
import {
	MAX_RECIPE_IMAGE_SIZE,
	type PhotoRefusal,
	RecipeSchema,
} from '#app/utils/recipe-validation.ts'
import { DurationHint } from './duration-hint.tsx'
import {
	ClientLeavesField,
	DiscardChangesGuard,
	useLeaveEditScreen,
} from './edit-screen.tsx'
import {
	ErrorList,
	Field,
	TextareaField,
	useFocusErrorOnFailedSave,
} from './forms.tsx'
import { keepReturnFromSaving, useNavBarForm } from './nav-bar.tsx'
import {
	IngredientFields,
	type IngredientFieldValue,
} from './ingredient-fields.tsx'
import {
	InstructionFields,
	type InstructionFieldValue,
} from './instruction-fields.tsx'
import {
	RecipeMetadataFields,
	type RecipeMetadataOption,
} from './recipe-metadata-fields.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

type RecipeFormProps = {
	recipe?: {
		id: string
		title: string
		description?: string | null
		activeTime?: number | null
		totalTime?: number | null
		yieldAmount?: number | null
		yieldLabel?: string | null
		sourceUrl?: string | null
		notes?: string | null
		image?: { objectKey: string; altText?: string | null } | null
		metadataValueIds?: string[]
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
	metadataOptions?: RecipeMetadataOption[]
}

function FormSection({
	title,
	summary,
	defaultOpen,
	errors,
	children,
}: {
	title: string
	summary?: string
	defaultOpen?: boolean
	/** The section's own errors (a list's), shown under its heading. */
	errors?: string[]
	children: React.ReactNode
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen ?? false)
	const errorId = useId()
	return (
		<details
			open={isOpen}
			onToggle={(e) => setIsOpen(e.currentTarget.open)}
			className="group/section border-border/50 border-t [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
		>
			<summary className="flex cursor-pointer items-center gap-2 py-3.5 select-none">
				<Icon
					name="chevron-down"
					size="sm"
					className="text-muted-foreground transition-transform group-not-open/section:-rotate-90"
				/>
				<h3 className={sectionLabelClass}>{title}</h3>
				{summary && (
					<span className="text-muted-foreground text-xs">{summary}</span>
				)}
			</summary>
			<div className="pb-6">
				{errors?.length ? (
					<div className="pb-3">
						<ErrorList id={errorId} errors={errors} focusable />
					</div>
				) : null}
				{children}
			</div>
		</details>
	)
}

/** The id the nav bar's Save submits (the route handle's `navForm`). */
export const RECIPE_FORM_ID = 'recipe-form'

export function RecipeForm({ recipe, metadataOptions = [] }: RecipeFormProps) {
	const actionData = useActionData<
		| {
				result: { error?: Record<string, string[]> }
				photoRefusal?: PhotoRefusal
		  }
		| { done: string }
	>()
	const lastResult =
		actionData && 'result' in actionData ? actionData.result : undefined
	const isEditing = !!recipe

	// An import can save a Recipe without ingredients or steps; editing it
	// starts with one empty row to fill, as a new Recipe does.
	const [ingredients, setIngredients] = useState<IngredientFieldValue[]>(
		recipe?.ingredients?.length
			? recipe.ingredients.map((i) => ({
					id: i.id,
					name: i.name,
					amount: i.amount ?? '',
					unit: i.unit ?? '',
					notes: i.notes ?? '',
					isHeading: i.isHeading ?? false,
					linkedRecipeId: i.linkedRecipeId ?? undefined,
					linkedRecipeTitle: i.linkedRecipeTitle ?? undefined,
				}))
			: [{ name: '', amount: '', unit: '', notes: '' }],
	)

	const [instructions, setInstructions] = useState<InstructionFieldValue[]>(
		recipe?.instructions?.length
			? recipe.instructions.map((i) => ({ id: i.id, content: i.content }))
			: [{ content: '' }],
	)

	// The rows this form loaded, from the same first render as the rows
	// above. Save removes only these when they are left out, so a row another
	// member added meanwhile stays (loaded-rows.ts).
	// Each row gets its id once it is added or first changed, and Save posts
	// it. A Save that reaches the server twice then finds the rows the first
	// one added instead of adding them again (loaded-rows.ts). Rows get it on
	// a change, not on the first render, so the server's render and the
	// browser's agree. The ids stay listed after their row is removed: an
	// earlier Save whose answer was lost may have stored it, and a replay
	// then removes it too.
	const [createdIds, setCreatedIds] = useState<string[]>([])
	function withRowIds<Row extends { id?: string }>(rows: Row[]) {
		const created: string[] = []
		const withIds = rows.map((row) => {
			if (row.id) return row
			const id = createId()
			created.push(id)
			return { ...row, id }
		})
		if (created.length > 0) setCreatedIds((ids) => [...ids, ...created])
		return withIds
	}

	const [loadedIds] = useState(() =>
		recipe
			? {
					ingredients: loadedIdsValue(recipe.ingredients),
					instructions: loadedIdsValue(recipe.instructions),
				}
			: null,
	)

	const savedPhoto = recipe?.image?.objectKey
		? `/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`
		: null
	const [imagePreview, setImagePreview] = useState<string | null>(savedPhoto)
	const photoInput = useRef<HTMLInputElement>(null)
	// A refused photo comes off the input, so the next Save goes through
	// without it: iOS gives no way to clear a picked file. The preview goes
	// back to the saved photo, which the refused Save left in place. A photo
	// the server had no turn to check stays, so Save tries it again.
	const photoRefusal =
		actionData && 'result' in actionData ? actionData.photoRefusal : undefined
	useEffect(() => {
		if (!lastResult?.error?.image || photoRefusal === 'busy') return
		if (photoInput.current) photoInput.current.value = ''
		setImagePreview(savedPhoto)
		// Once per answer, so a photo picked after it stays.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [actionData])

	const [form, fields] = useForm({
		// The nav bar's Save submits the form by this id (route handle).
		id: RECIPE_FORM_ID,
		constraint: getZodConstraint(RecipeSchema),
		lastResult: lastResult as any,
		onValidate({ formData }) {
			const submission = parseWithZod(formData, { schema: RecipeSchema })
			// A Save that found errors (not a blur's revalidation).
			if (submission.status === 'error') focusErrorAfterRender()
			return submission
		},
		defaultValue: {
			title: recipe?.title ?? '',
			description: recipe?.description ?? '',
			activeTime: recipe?.activeTime?.toString(),
			totalTime: recipe?.totalTime?.toString(),
			yieldAmount: recipe?.yieldAmount?.toString(),
			yieldLabel: recipe?.yieldLabel ?? '',
			sourceUrl: recipe?.sourceUrl ?? '',
			notes: recipe?.notes ?? '',
		},
		shouldRevalidate: 'onBlur',
		shouldValidate: 'onSubmit',
	})
	const focusErrorAfterRender = useFocusErrorOnFailedSave(
		RECIPE_FORM_ID,
		lastResult,
	)
	// The ingredients and steps submit through hidden inputs, by position.
	// Their errors show at the rows they are about; a change to the rows after
	// a failed Save checks them again, so an error goes once it is fixed and
	// never moves to a row that took the place of a removed one.
	const ingredientErrors = listErrors(form.allErrors, 'ingredients')
	const instructionErrors = listErrors(form.allErrors, 'instructions')
	const rowsHaveErrors =
		ingredientErrors.list !== undefined ||
		ingredientErrors.rows.length > 0 ||
		instructionErrors.list !== undefined ||
		instructionErrors.rows.length > 0
	// Only a change to the rows checks them again: errors arriving do not,
	// or an error only the server can find (a gone linked Recipe) would be
	// checked away by the form's own rules as soon as it shows.
	const rowsHadErrors = useRef(rowsHaveErrors)
	useEffect(() => {
		rowsHadErrors.current = rowsHaveErrors
	})
	const rowsSeen = useRef<unknown[] | null>(null)
	useEffect(() => {
		const seen = rowsSeen.current
		rowsSeen.current = [ingredients, instructions]
		if (!seen || (seen[0] === ingredients && seen[1] === instructions)) return
		if (rowsHadErrors.current) form.validate()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ingredients, instructions])

	// A Save that went through leaves as if the screen was dismissed.
	const { leaving, leave } = useLeaveEditScreen()
	const done = isEditScreenDone(actionData) ? actionData.done : null
	const notice = isEditScreenDone(actionData) ? actionData.notice : undefined
	useEffect(() => {
		if (!done) return
		// The server has the Save.
		haptic('success')
		// Shown here rather than from a toast cookie: leaving cancels the root
		// reload that would read one. Styled as a server toast is (toaster.tsx),
		// since a redirect shows the same notice that way.
		if (notice) toast.message(undefined, { description: notice })
		leave(
			resolveAfterSave({ idx: historyIndex(), log: getHistoryLog(), to: done }),
		)
		// Once per answer.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [actionData])

	const { key: yieldAmountKey, ...yieldAmountProps } = getInputProps(
		fields.yieldAmount,
		{ type: 'number' },
	)
	const { key: yieldLabelKey, ...yieldLabelProps } = getInputProps(
		fields.yieldLabel,
		{ type: 'text' },
	)

	// Phone photos are often over the upload limit; shrink them here.
	const { preparing: preparingPhoto, fit: fitPhoto } = useFitFileInput(
		MAX_RECIPE_IMAGE_SIZE,
	)
	useNavBarForm(RECIPE_FORM_ID, { blocked: preparingPhoto || leaving })
	const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const input = e.currentTarget
		// A later pick owns the preview.
		if (!(await fitPhoto(input))) return
		const file = input.files?.[0]
		if (file) {
			const reader = new FileReader()
			reader.onload = (event) => {
				setImagePreview(event.target?.result as string)
			}
			reader.readAsDataURL(file)
		}
	}

	return (
		<Form
			method="POST"
			encType="multipart/form-data"
			{...getFormProps(form)}
			onKeyDown={(event) => keepReturnFromSaving(event, { titleSaves: true })}
			className="space-y-4"
		>
			<ClientLeavesField />
			{loadedIds && (
				<>
					<input
						type="hidden"
						name="loadedIngredientIds"
						value={loadedIds.ingredients}
					/>
					<input
						type="hidden"
						name="loadedInstructionIds"
						value={loadedIds.instructions}
					/>
					<input
						type="hidden"
						name={CREATED_IDS_FIELD}
						value={JSON.stringify(createdIds)}
					/>
				</>
			)}
			<DiscardChangesGuard
				formId={RECIPE_FORM_ID}
				description={
					isEditing
						? 'Your changes to this Recipe won’t be saved.'
						: 'This Recipe won’t be saved.'
				}
			/>
			{/* Form-level errors */}
			{form.errors && form.errors.length > 0 && (
				<div className="border-destructive bg-destructive/10 rounded-lg border p-4">
					<ErrorList errors={form.errors} id={form.errorId} focusable />
				</div>
			)}

			<Field
				labelProps={{ children: 'Title' }}
				inputProps={{
					...getInputProps(fields.title, { type: 'text' }),
					placeholder: 'Recipe title',
				}}
				errors={fields.title.errors}
			/>

			{/* Ingredients Section */}
			<FormSection
				title="Ingredients"
				summary={(() => {
					const count = ingredients.filter((i) => i.name).length
					if (count === 0) return undefined
					return `${count} ${count === 1 ? 'item' : 'items'}`
				})()}
				defaultOpen={isEditing || ingredients.length <= 1}
				errors={ingredientErrors.list}
			>
				<IngredientFields
					ingredients={ingredients}
					onChange={(rows) => setIngredients(withRowIds(rows))}
					excludeRecipeId={recipe?.id}
					rowErrors={ingredientErrors.rows}
				/>
				<div className="mt-6 space-y-2">
					<p className="text-sm font-medium">This recipe makes</p>
					<div className="flex min-w-0 items-center gap-2">
						<Input
							key={yieldAmountKey}
							{...yieldAmountProps}
							step="any"
							inputMode="decimal"
							enterKeyHint="done"
							placeholder="4"
							aria-label="Amount this recipe makes"
							aria-invalid={
								fields.yieldAmount.errors?.length ? true : undefined
							}
							aria-describedby={fields.yieldAmount.errorId}
							className="w-24 shrink-0 tabular-nums"
						/>
						<Input
							key={yieldLabelKey}
							{...yieldLabelProps}
							list="yield-label-suggestions"
							placeholder="servings, dough balls, loaves…"
							aria-label="What this recipe makes"
							aria-invalid={fields.yieldLabel.errors?.length ? true : undefined}
							aria-describedby={fields.yieldLabel.errorId}
							className="min-w-0 flex-1"
						/>
					</div>
					<p className="text-muted-foreground text-xs">
						Optional—for example, 4 servings or 2 dough balls. Leave both blank
						if unknown.
					</p>
					<ErrorList
						id={fields.yieldAmount.errorId}
						errors={fields.yieldAmount.errors}
					/>
					<ErrorList
						id={fields.yieldLabel.errorId}
						errors={fields.yieldLabel.errors}
					/>
					<datalist id="yield-label-suggestions">
						{['servings', 'pieces', 'batch', 'cake', 'loaf'].map(
							(suggestion) => (
								<option key={suggestion} value={suggestion} />
							),
						)}
					</datalist>
				</div>
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
				errors={instructionErrors.list}
			>
				<InstructionFields
					instructions={instructions}
					onChange={(rows) => setInstructions(withRowIds(rows))}
					rowErrors={instructionErrors.rows}
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

			{/* Photo Section */}
			<FormSection
				title="Photo"
				summary={imagePreview ? 'Has photo' : 'No photo'}
				defaultOpen={false}
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
					<div className="border-border/60 bg-muted/30 relative aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-dashed sm:w-40">
						{imagePreview?.startsWith('data:') ? (
							// A photo just picked: there are no resizes to choose from yet.
							<img
								src={imagePreview}
								alt="Recipe preview"
								className="h-full w-full object-cover"
								{...IMG_SIZES.formPreview}
							/>
						) : imagePreview ? (
							<Img
								src={imagePreview}
								alt="Recipe preview"
								className="h-full w-full object-cover"
								{...IMG_SIZES.formPreview}
							/>
						) : (
							<div className="flex h-full w-full items-center justify-center">
								<Icon name="camera" className="text-muted-foreground size-8" />
							</div>
						)}
					</div>
					<div className="space-y-2">
						<Input
							ref={photoInput}
							type="file"
							name="image"
							accept="image/jpeg,image/png,image/webp"
							onChange={handleImageChange}
							className="max-w-full text-sm"
							aria-invalid={form.allErrors.image ? true : undefined}
						/>
						<p className="text-muted-foreground text-xs">
							JPG, PNG or WebP. Large photos are resized.
						</p>
						<ErrorList errors={form.allErrors.image} />
					</div>
				</div>
			</FormSection>

			{/* Details Section */}
			<FormSection title="Details" summary="Optional">
				<div className="space-y-4">
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

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<Field
								labelProps={{ children: 'Active Time (min)' }}
								inputProps={{
									...getInputProps(fields.activeTime, {
										type: 'number',
										ariaDescribedBy: fields.activeTime.descriptionId,
									}),
									min: 1,
									inputMode: 'numeric',
									enterKeyHint: 'done',
									placeholder: '—',
								}}
								errors={fields.activeTime.errors}
							/>
							<DurationHint
								id={fields.activeTime.descriptionId}
								minutes={fields.activeTime.value}
								className="mt-1"
							/>
						</div>
						<div>
							<Field
								labelProps={{ children: 'Total Time (min)' }}
								inputProps={{
									...getInputProps(fields.totalTime, {
										type: 'number',
										ariaDescribedBy: fields.totalTime.descriptionId,
									}),
									min: 1,
									inputMode: 'numeric',
									enterKeyHint: 'done',
									placeholder: '—',
								}}
								errors={fields.totalTime.errors}
							/>
							<DurationHint
								id={fields.totalTime.descriptionId}
								minutes={fields.totalTime.value}
								className="mt-1"
							/>
						</div>
					</div>
				</div>
			</FormSection>

			<FormSection
				title="Classification"
				summary={
					recipe?.metadataValueIds?.length
						? `${recipe.metadataValueIds.length} selected`
						: 'Optional'
				}
				errors={Object.entries(form.allErrors).flatMap(([name, errors]) =>
					name === 'recipeMetadata' || name.startsWith('recipeMetadata.')
						? errors
						: [],
				)}
			>
				<RecipeMetadataFields
					options={metadataOptions}
					selectedValueIds={recipe?.metadataValueIds}
				/>
			</FormSection>
		</Form>
	)
}
