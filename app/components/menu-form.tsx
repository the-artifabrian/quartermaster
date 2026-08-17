import {
	getFormProps,
	getInputProps,
	useForm,
	type FieldMetadata,
	type FormMetadata,
} from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { useId } from 'react'
import { Form, Link, useActionData, useNavigation } from 'react-router'
import {
	RecipePicker,
	type RecipePickerRecipe,
} from '#app/components/recipe-picker.tsx'
import { RecipeThumb } from '#app/components/recipe-selector.tsx'
import {
	formatScaleMultiplier,
	MenuBuilderSchema,
	type MenuBuilderInput,
	type MenuItemInput,
} from '#app/utils/menu-validation.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { ErrorList, Field, TextareaField } from './forms.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'

export type MenuBuilderItem = {
	id: string
	recipeId: string | null
	/** Frozen display title — what a missing card keeps showing. */
	recipeTitle: string
	scaleMultiplier: number
	note: string | null
}

type MenuFormProps = {
	menu?: {
		id: string
		title: string
		description?: string | null
		defaultGuestCount?: number | null
	}
	submitLabel?: string
	/**
	 * When present, the form edits the Menu's Recipe cards too: existing items
	 * plus the household Recipes the picker may add. Create stays metadata-only.
	 */
	builder?: {
		items: MenuBuilderItem[]
		recipes: RecipePickerRecipe[]
	}
}

export function MenuForm({
	menu,
	submitLabel = 'Save Menu',
	builder,
}: MenuFormProps) {
	const actionData = useActionData<{
		result: { error?: Record<string, string[]> }
	}>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'
	const formId = useId()

	// One schema for both modes: `items` is optional, so metadata-only create
	// parses cleanly and the create action simply never reads items.
	const [form, fields] = useForm({
		id: formId,
		constraint: getZodConstraint(MenuBuilderSchema),
		lastResult: actionData?.result as any,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: MenuBuilderSchema })
		},
		defaultValue: {
			title: menu?.title ?? '',
			description: menu?.description ?? '',
			defaultGuestCount: menu?.defaultGuestCount?.toString() ?? '',
			...(builder && {
				items: builder.items.map((item) => ({
					id: item.id,
					recipeId: item.recipeId ?? '',
					scaleMultiplier: formatScaleMultiplier(item.scaleMultiplier),
					note: item.note ?? '',
				})),
			}),
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

			{builder ? (
				<MenuItemsBuilder form={form} fields={fields} builder={builder} />
			) : null}

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

type MenuFormMetadata = FormMetadata<MenuBuilderInput>
type MenuFormFields = ReturnType<MenuFormMetadata['getFieldset']>

function MenuItemsBuilder({
	form,
	fields,
	builder,
}: {
	form: MenuFormMetadata
	fields: MenuFormFields
	builder: NonNullable<MenuFormProps['builder']>
}) {
	const itemList = fields.items.getFieldList()
	const itemsById = new Map(builder.items.map((item) => [item.id, item]))
	const recipesById = new Map(builder.recipes.map((r) => [r.id, r]))
	const usedRecipeIds = itemList
		.map((itemMeta) => itemMeta.getFieldset().recipeId.value)
		.filter((id): id is string => Boolean(id))

	return (
		<fieldset className="pt-2">
			<legend className={sectionLabelClass}>Recipes</legend>
			<ErrorList errors={fields.items.errors} id={fields.items.errorId} />
			{itemList.length === 0 ? (
				<p className="text-muted-foreground border-border/60 mt-3 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm">
					No recipes on this menu yet.
				</p>
			) : (
				<ul className="mt-3 space-y-2">
					{itemList.map((itemMeta, index) => (
						<MenuItemRow
							key={itemMeta.key}
							form={form}
							fields={fields}
							itemMeta={itemMeta}
							index={index}
							itemsById={itemsById}
							recipesById={recipesById}
							recipes={builder.recipes}
							usedRecipeIds={usedRecipeIds}
						/>
					))}
				</ul>
			)}
			<div className="mt-3">
				<RecipePicker
					recipes={builder.recipes}
					excludeRecipeIds={usedRecipeIds}
					onPick={(recipe) => {
						form.insert({
							name: fields.items.name,
							defaultValue: {
								id: '',
								recipeId: recipe.id,
								scaleMultiplier: '1',
								note: '',
							},
						})
					}}
				/>
			</div>
		</fieldset>
	)
}

function MenuItemRow({
	form,
	fields,
	itemMeta,
	index,
	itemsById,
	recipesById,
	recipes,
	usedRecipeIds,
}: {
	form: MenuFormMetadata
	fields: MenuFormFields
	itemMeta: FieldMetadata<MenuItemInput>
	index: number
	itemsById: Map<string, MenuBuilderItem>
	recipesById: Map<string, RecipePickerRecipe>
	recipes: RecipePickerRecipe[]
	usedRecipeIds: string[]
}) {
	const item = itemMeta.getFieldset()
	const recipeId = item.recipeId.value
	const stored = item.id.value ? itemsById.get(item.id.value) : undefined
	const recipe = recipeId ? recipesById.get(recipeId) : undefined
	// A card is missing when its reference no longer resolves to a household
	// Recipe (deleted, or moved away) — frozen title keeps it identifiable.
	const missing = !recipe
	const title = recipe?.title ?? stored?.recipeTitle ?? 'Recipe'

	const { key: idKey, ...idProps } = getInputProps(item.id, { type: 'hidden' })
	const { key: recipeIdKey, ...recipeIdProps } = getInputProps(item.recipeId, {
		type: 'hidden',
	})
	const { key: multiplierKey, ...multiplierProps } = getInputProps(
		item.scaleMultiplier,
		{ type: 'text' },
	)
	const { key: noteKey, ...noteProps } = getInputProps(item.note, {
		type: 'text',
	})

	return (
		<li className="border-border/60 bg-card rounded-lg border p-3">
			<input key={idKey} {...idProps} />
			<input key={recipeIdKey} {...recipeIdProps} />
			<div className="flex items-start gap-3">
				{missing ? (
					<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
						<Icon
							name="question-mark-circled"
							className="text-muted-foreground size-4"
						/>
					</span>
				) : (
					<RecipeThumb title={title} image={recipe?.image ?? null} />
				)}
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 min-w-0 text-sm font-medium break-words">
						{title}
					</p>
					{missing ? (
						<p className="text-destructive mt-0.5 text-xs">
							No longer in your recipe library
						</p>
					) : null}
				</div>
				<label className="flex shrink-0 items-center gap-1">
					<span className="sr-only">Scale multiplier for {title}</span>
					<Input
						key={multiplierKey}
						{...multiplierProps}
						inputMode="decimal"
						className="h-10 w-14 text-center"
					/>
					<span aria-hidden="true" className="text-muted-foreground text-sm">
						×
					</span>
				</label>
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					{...form.remove.getButtonProps({ name: fields.items.name, index })}
					aria-label={`Remove ${title} from menu`}
				>
					<Icon name="trash" size="sm" />
				</Button>
			</div>
			{missing ? (
				<div className="mt-2 flex items-center gap-2">
					<RecipePicker
						recipes={recipes}
						excludeRecipeIds={usedRecipeIds}
						label="Replace recipe"
						onPick={(replacement) => {
							form.update({
								name: item.recipeId.name,
								value: replacement.id,
							})
						}}
					/>
				</div>
			) : null}
			<Input
				key={noteKey}
				{...noteProps}
				placeholder="Note (optional) — e.g. serve at room temperature"
				aria-label={`Note for ${title}`}
				className="mt-2 h-10"
			/>
			<ErrorList
				errors={[
					...(itemMeta.errors ?? []),
					...(item.scaleMultiplier.errors ?? []),
					...(item.note.errors ?? []),
				]}
				id={itemMeta.errorId}
			/>
		</li>
	)
}
