import {
	getFormProps,
	getInputProps,
	getTextareaProps,
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
	type MenuSectionInput,
	type MenuShoppingLineInput,
} from '#app/utils/menu-validation.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { ErrorList, Field, TextareaField } from './forms.tsx'
import { Button } from './ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { StatusButton } from './ui/status-button.tsx'
import { Textarea } from './ui/textarea.tsx'

export type MenuBuilderShoppingLine = {
	name: string
	quantity: string | null
	unit: string | null
}

export type MenuBuilderItem =
	| {
			id: string
			kind: 'recipe'
			recipeId: string | null
			/** Frozen display title — what a missing card keeps showing. */
			recipeTitle: string
			scaleMultiplier: number
			note: string | null
	  }
	| {
			id: string
			kind: 'note'
			text: string
			shoppingLines: MenuBuilderShoppingLine[]
	  }

type MenuBuilderRecipeItem = Extract<MenuBuilderItem, { kind: 'recipe' }>

export type MenuBuilderSection = {
	id: string
	/** null = the headingless unnamed section; any section may gain or lose
	 * its name in place. */
	name: string | null
	items: MenuBuilderItem[]
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
	 * When present, the form edits the Menu's sections and Recipe cards too:
	 * the stored sections plus the household Recipes the picker may add.
	 * Create stays metadata-only.
	 */
	builder?: {
		sections: MenuBuilderSection[]
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

	// One schema for both modes: `sections` is optional, so metadata-only
	// create parses cleanly and the create action simply never reads sections.
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
				sections: builder.sections.map((section) => ({
					id: section.id,
					name: section.name ?? '',
					items: section.items.map((item) =>
						item.kind === 'note'
							? {
									id: item.id,
									kind: 'note',
									text: item.text,
									shoppingLines: item.shoppingLines.map((line) => ({
										name: line.name,
										quantity: line.quantity ?? '',
										unit: line.unit ?? '',
									})),
								}
							: {
									id: item.id,
									kind: 'recipe',
									recipeId: item.recipeId ?? '',
									scaleMultiplier: formatScaleMultiplier(item.scaleMultiplier),
									note: item.note ?? '',
								},
					),
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
				<MenuSectionsBuilder form={form} fields={fields} builder={builder} />
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
type MenuSectionMetadata = FieldMetadata<MenuSectionInput>

/**
 * Paired labelled move up/down intent buttons. Reordering moves the row's DOM
 * node, which drops keyboard focus; refocusing the moved row's control
 * afterwards (or its twin once the row hits a boundary and this one disables)
 * lets a keyboard user keep pressing Enter to walk a row through the list.
 * The buttons are found again by accessible label — the row's title — because
 * conform regenerates its row keys (and so the DOM ids) whenever the form
 * revalidates, and the re-render lands asynchronously, so focus is re-asserted
 * over a few frames rather than guessing the exact commit timing.
 */
function ReorderButtons({
	form,
	name,
	index,
	count,
	label,
}: {
	form: MenuFormMetadata
	name: string
	index: number
	count: number
	label: string
}) {
	const upLabel = `Move ${label} up`
	const downLabel = `Move ${label} down`
	const refocus = (preferred: string, twin: string) => {
		const find = (ariaLabel: string) =>
			Array.from(
				document.getElementById(form.id)?.querySelectorAll('button') ?? [],
			).find((b) => b.getAttribute('aria-label') === ariaLabel && !b.disabled)
		let attempts = 0
		const tick = () => {
			;(find(preferred) ?? find(twin))?.focus()
			if (++attempts < 4) requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	}
	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				{...form.reorder.getButtonProps({ name, from: index, to: index - 1 })}
				disabled={index === 0}
				aria-label={upLabel}
				onClick={() => refocus(upLabel, downLabel)}
			>
				<Icon name="arrow-up" size="sm" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				{...form.reorder.getButtonProps({ name, from: index, to: index + 1 })}
				disabled={index === count - 1}
				aria-label={downLabel}
				onClick={() => refocus(downLabel, upLabel)}
			>
				<Icon name="arrow-down" size="sm" />
			</Button>
		</>
	)
}

/** Reads the builder's live values into the plain shape `form.update` takes. */
function readSections(sectionList: MenuSectionMetadata[]) {
	return sectionList.map((sectionMeta) => {
		const section = sectionMeta.getFieldset()
		return {
			id: section.id.value ?? '',
			name: section.name.value ?? '',
			items: section.items.getFieldList().map((itemMeta) => {
				const item = itemMeta.getFieldset()
				return {
					id: item.id.value ?? '',
					kind: item.kind.value ?? 'recipe',
					recipeId: item.recipeId.value ?? '',
					scaleMultiplier: item.scaleMultiplier.value ?? '',
					note: item.note.value ?? '',
					text: item.text.value ?? '',
					shoppingLines: item.shoppingLines.getFieldList().map((lineMeta) => {
						const line = lineMeta.getFieldset()
						return {
							name: line.name.value ?? '',
							quantity: line.quantity.value ?? '',
							unit: line.unit.value ?? '',
						}
					}),
				}
			}),
		}
	})
}

function MenuSectionsBuilder({
	form,
	fields,
	builder,
}: {
	form: MenuFormMetadata
	fields: MenuFormFields
	builder: NonNullable<MenuFormProps['builder']>
}) {
	const sectionList = fields.sections.getFieldList()
	// Stored Recipe cards by id — the frozen-title lookup for missing cards.
	const itemsById = new Map(
		builder.sections
			.flatMap((s) => s.items)
			.filter((item): item is MenuBuilderRecipeItem => item.kind === 'recipe')
			.map((item) => [item.id, item]),
	)
	const recipesById = new Map(builder.recipes.map((r) => [r.id, r]))

	// A Recipe appears once per Menu, so the pickers exclude every section's.
	const usedRecipeIds = sectionList
		.flatMap((sectionMeta) =>
			sectionMeta
				.getFieldset()
				.items.getFieldList()
				.map((itemMeta) => itemMeta.getFieldset().recipeId.value),
		)
		.filter((id): id is string => Boolean(id))

	// How each section reads in move controls and menus right now — a blank
	// name is the headingless unnamed section.
	const sectionLabels = sectionList.map((sectionMeta) => {
		const section = sectionMeta.getFieldset()
		return section.name.value?.trim() || 'Unnamed section'
	})

	function moveItemToSection(
		fromSection: number,
		itemIndex: number,
		toSection: number,
	) {
		const sections = readSections(sectionList)
		const [moved] = sections[fromSection]!.items.splice(itemIndex, 1)
		if (!moved) return
		sections[toSection]!.items.push(moved)
		form.update({ name: fields.sections.name, value: sections })
	}

	function removeSection(sectionIndex: number) {
		const sections = readSections(sectionList)
		const [removed] = sections.splice(sectionIndex, 1)
		if (!removed) return
		// Removing a section removes its heading, never its food: items land in
		// the headingless section, created in place when every survivor is named.
		if (removed.items.length > 0) {
			const unnamed = sections.find((s) => !s.name.trim())
			if (unnamed) unnamed.items.push(...removed.items)
			else {
				sections.splice(sectionIndex, 0, {
					id: '',
					name: '',
					items: removed.items,
				})
			}
		}
		// Cards need somewhere to live — an emptied menu keeps one blank section.
		if (sections.length === 0) sections.push({ id: '', name: '', items: [] })
		form.update({ name: fields.sections.name, value: sections })
	}

	return (
		<fieldset className="pt-2">
			<legend className={sectionLabelClass}>Recipes</legend>
			<ErrorList errors={fields.sections.errors} id={fields.sections.errorId} />
			{sectionList.length > 1 ? (
				<p className="text-muted-foreground mt-2 text-sm">
					A section’s arrows move it as one block, cards and all. To move a
					single card between sections, use its “Move to…”.
				</p>
			) : null}
			<ul className="mt-3 space-y-6">
				{sectionList.map((sectionMeta, sectionIndex) => (
					<MenuSectionCard
						key={sectionMeta.key}
						form={form}
						fields={fields}
						sectionMeta={sectionMeta}
						sectionIndex={sectionIndex}
						sectionCount={sectionList.length}
						sectionLabels={sectionLabels}
						itemsById={itemsById}
						recipesById={recipesById}
						recipes={builder.recipes}
						usedRecipeIds={usedRecipeIds}
						onMoveItem={moveItemToSection}
						onRemoveSection={removeSection}
					/>
				))}
			</ul>
			<div className="mt-4">
				<Button
					type="button"
					variant="outline"
					className="h-11 md:h-10"
					onClick={() =>
						form.insert({
							name: fields.sections.name,
							defaultValue: { id: '', name: '', items: [] },
						})
					}
				>
					<Icon name="plus" size="sm" />
					Add section
				</Button>
			</div>
		</fieldset>
	)
}

function MenuSectionCard({
	form,
	fields,
	sectionMeta,
	sectionIndex,
	sectionCount,
	sectionLabels,
	itemsById,
	recipesById,
	recipes,
	usedRecipeIds,
	onMoveItem,
	onRemoveSection,
}: {
	form: MenuFormMetadata
	fields: MenuFormFields
	sectionMeta: MenuSectionMetadata
	sectionIndex: number
	sectionCount: number
	sectionLabels: string[]
	itemsById: Map<string, MenuBuilderRecipeItem>
	recipesById: Map<string, RecipePickerRecipe>
	recipes: RecipePickerRecipe[]
	usedRecipeIds: string[]
	onMoveItem: (
		fromSection: number,
		itemIndex: number,
		toSection: number,
	) => void
	onRemoveSection: (sectionIndex: number) => void
}) {
	const section = sectionMeta.getFieldset()
	const itemList = section.items.getFieldList()
	const label = sectionLabels[sectionIndex]!
	const solo = sectionCount === 1
	// A blank name marks the headingless home for loose cards — deleting it
	// would delete food (or, solo, do nothing), so the trash waits until the
	// section is named or emptied.
	const headinglessHome =
		!section.name.value?.trim() && (itemList.length > 0 || solo)

	const { key: idKey, ...idProps } = getInputProps(section.id, {
		type: 'hidden',
	})
	const { key: nameKey, ...nameProps } = getInputProps(section.name, {
		type: 'text',
	})

	return (
		// The tinted panel makes a section legible as the one unit its move
		// arrows carry — a solo section keeps the flat sectionless look.
		<li className={solo ? undefined : 'bg-muted/40 rounded-xl p-3'}>
			<input key={idKey} {...idProps} />
			<div className="mb-2 flex items-start gap-1">
				<div className="min-w-0 flex-1">
					<Input
						key={nameKey}
						{...nameProps}
						placeholder="Section name (optional) — e.g. Dessert"
						aria-label="Section name"
						className="h-11"
					/>
					<ErrorList errors={section.name.errors} id={section.name.errorId} />
				</div>
				{solo ? null : (
					<ReorderButtons
						form={form}
						name={fields.sections.name}
						index={sectionIndex}
						count={sectionCount}
						label={label}
					/>
				)}
				{headinglessHome ? null : (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => onRemoveSection(sectionIndex)}
						aria-label={`Remove ${label} — its cards stay on the menu`}
					>
						<Icon name="trash" size="sm" />
					</Button>
				)}
			</div>
			{itemList.length === 0 ? (
				<p className="text-muted-foreground border-border/60 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm">
					{solo
						? 'No recipes on this menu yet.'
						: 'No recipes in this section yet.'}
				</p>
			) : (
				<ul className="space-y-2">
					{itemList.map((itemMeta, index) =>
						itemMeta.getFieldset().kind.value === 'note' ? (
							<MenuNoteRow
								key={itemMeta.key}
								form={form}
								itemsName={section.items.name}
								itemMeta={itemMeta}
								index={index}
								itemCount={itemList.length}
								sectionIndex={sectionIndex}
								sectionLabels={sectionLabels}
								onMoveToSection={(toSection) =>
									onMoveItem(sectionIndex, index, toSection)
								}
							/>
						) : (
							<MenuItemRow
								key={itemMeta.key}
								form={form}
								itemsName={section.items.name}
								itemMeta={itemMeta}
								index={index}
								itemCount={itemList.length}
								sectionIndex={sectionIndex}
								sectionLabels={sectionLabels}
								itemsById={itemsById}
								recipesById={recipesById}
								recipes={recipes}
								usedRecipeIds={usedRecipeIds}
								onMoveToSection={(toSection) =>
									onMoveItem(sectionIndex, index, toSection)
								}
							/>
						),
					)}
				</ul>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<RecipePicker
					recipes={recipes}
					excludeRecipeIds={usedRecipeIds}
					onPick={(recipe) => {
						form.insert({
							name: section.items.name,
							defaultValue: {
								id: '',
								kind: 'recipe',
								recipeId: recipe.id,
								scaleMultiplier: '1',
								note: '',
							},
						})
					}}
				/>
				{/* Drinks, shared prep, serving reminders — flexible cards instead
				    of dedicated subsystems (#102). */}
				<Button
					type="button"
					variant="outline"
					onClick={() =>
						form.insert({
							name: section.items.name,
							defaultValue: {
								id: '',
								kind: 'note',
								text: '',
								shoppingLines: [],
							},
						})
					}
				>
					<Icon name="pencil-2" size="sm" />
					Add note
				</Button>
			</div>
		</li>
	)
}

function MenuItemRow({
	form,
	itemsName,
	itemMeta,
	index,
	itemCount,
	sectionIndex,
	sectionLabels,
	itemsById,
	recipesById,
	recipes,
	usedRecipeIds,
	onMoveToSection,
}: {
	form: MenuFormMetadata
	itemsName: string
	itemMeta: FieldMetadata<MenuItemInput>
	index: number
	itemCount: number
	sectionIndex: number
	sectionLabels: string[]
	itemsById: Map<string, MenuBuilderRecipeItem>
	recipesById: Map<string, RecipePickerRecipe>
	recipes: RecipePickerRecipe[]
	usedRecipeIds: string[]
	onMoveToSection: (toSection: number) => void
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
	const { key: kindKey, ...kindProps } = getInputProps(item.kind, {
		type: 'hidden',
	})
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
			<input key={kindKey} {...kindProps} />
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
					{...form.remove.getButtonProps({ name: itemsName, index })}
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
			{/* Labelled, keyboard-reachable ordering controls — dependable on
			    phone where pointer drag is not (#101). */}
			<div className="mt-2 flex items-center gap-1">
				<ReorderButtons
					form={form}
					name={itemsName}
					index={index}
					count={itemCount}
					label={title}
				/>
				<MoveToSectionMenu
					label={title}
					sectionIndex={sectionIndex}
					sectionLabels={sectionLabels}
					onMoveToSection={onMoveToSection}
				/>
			</div>
			{/* Separate lists so each input's aria-describedby resolves */}
			<ErrorList errors={itemMeta.errors} id={itemMeta.errorId} />
			<ErrorList
				errors={item.scaleMultiplier.errors}
				id={item.scaleMultiplier.errorId}
			/>
			<ErrorList errors={item.note.errors} id={item.note.errorId} />
		</li>
	)
}

/** The explicit cross-section move — no nested drag required (#101). */
function MoveToSectionMenu({
	label,
	sectionIndex,
	sectionLabels,
	onMoveToSection,
}: {
	label: string
	sectionIndex: number
	sectionLabels: string[]
	onMoveToSection: (toSection: number) => void
}) {
	if (sectionLabels.length <= 1) return null
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="text-muted-foreground h-11 px-3 md:h-9"
					aria-label={`Move ${label} to another section`}
				>
					Move to…
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{sectionLabels.map((sectionLabel, target) =>
					target === sectionIndex ? null : (
						<DropdownMenuItem
							key={target}
							onSelect={() => onMoveToSection(target)}
						>
							{sectionLabel}
						</DropdownMenuItem>
					),
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/**
 * How a note card reads in reorder/remove/move controls: named by its own
 * text so labels stay tellable-apart when a section holds several notes.
 */
function noteCardLabel(text: string | undefined) {
	const trimmed = text?.trim() ?? ''
	if (!trimmed) return 'note'
	return trimmed.length > 40
		? `note “${trimmed.slice(0, 40)}…”`
		: `note “${trimmed}”`
}

function MenuNoteRow({
	form,
	itemsName,
	itemMeta,
	index,
	itemCount,
	sectionIndex,
	sectionLabels,
	onMoveToSection,
}: {
	form: MenuFormMetadata
	itemsName: string
	itemMeta: FieldMetadata<MenuItemInput>
	index: number
	itemCount: number
	sectionIndex: number
	sectionLabels: string[]
	onMoveToSection: (toSection: number) => void
}) {
	const item = itemMeta.getFieldset()
	const label = noteCardLabel(item.text.value)
	const lineList = item.shoppingLines.getFieldList()

	const { key: idKey, ...idProps } = getInputProps(item.id, { type: 'hidden' })
	const { key: kindKey, ...kindProps } = getInputProps(item.kind, {
		type: 'hidden',
	})
	const { key: textKey, ...textProps } = getTextareaProps(item.text)

	return (
		<li className="border-border/60 bg-card rounded-lg border p-3">
			<input key={idKey} {...idProps} />
			<input key={kindKey} {...kindProps} />
			<div className="flex items-start gap-3">
				<span className="bg-muted/70 flex size-9 shrink-0 items-center justify-center rounded-md">
					<Icon name="pencil-2" className="text-muted-foreground size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<Textarea
						key={textKey}
						{...textProps}
						rows={2}
						placeholder="e.g. Lemonade with mint — mix just before serving"
						aria-label="Note text"
					/>
					<ErrorList errors={item.text.errors} id={item.text.errorId} />
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					{...form.remove.getButtonProps({ name: itemsName, index })}
					aria-label={`Remove ${label} from menu`}
				>
					<Icon name="trash" size="sm" />
				</Button>
			</div>
			{lineList.length > 0 ? (
				<ul className="mt-2 space-y-2">
					{lineList.map((lineMeta, lineIndex) => (
						<ShoppingLineRow
							key={lineMeta.key}
							form={form}
							linesName={item.shoppingLines.name}
							lineMeta={lineMeta}
							lineIndex={lineIndex}
						/>
					))}
				</ul>
			) : null}
			<div className="mt-2 flex flex-wrap items-center gap-1">
				{/* Ordinary Shopping lines so supporting purchases travel with the
				    Menu — required name, optional quantity/unit (#102). */}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="text-muted-foreground h-11 px-3 md:h-9"
					onClick={() =>
						form.insert({
							name: item.shoppingLines.name,
							defaultValue: { name: '', quantity: '', unit: '' },
						})
					}
				>
					<Icon name="cart" size="sm" />
					Add shopping line
				</Button>
				<ReorderButtons
					form={form}
					name={itemsName}
					index={index}
					count={itemCount}
					label={label}
				/>
				<MoveToSectionMenu
					label={label}
					sectionIndex={sectionIndex}
					sectionLabels={sectionLabels}
					onMoveToSection={onMoveToSection}
				/>
			</div>
			<ErrorList errors={itemMeta.errors} id={itemMeta.errorId} />
			<ErrorList
				errors={item.shoppingLines.errors}
				id={item.shoppingLines.errorId}
			/>
		</li>
	)
}

function ShoppingLineRow({
	form,
	linesName,
	lineMeta,
	lineIndex,
}: {
	form: MenuFormMetadata
	linesName: string
	lineMeta: FieldMetadata<MenuShoppingLineInput>
	lineIndex: number
}) {
	const line = lineMeta.getFieldset()
	const { key: nameKey, ...nameProps } = getInputProps(line.name, {
		type: 'text',
	})
	const { key: quantityKey, ...quantityProps } = getInputProps(line.quantity, {
		type: 'text',
	})
	const { key: unitKey, ...unitProps } = getInputProps(line.unit, {
		type: 'text',
	})

	return (
		<li>
			<div className="flex items-start gap-2">
				<Input
					key={nameKey}
					{...nameProps}
					placeholder="e.g. mint"
					aria-label={`Shopping line ${lineIndex + 1} name`}
					className="h-10 min-w-0 flex-1"
				/>
				<Input
					key={quantityKey}
					{...quantityProps}
					placeholder="Qty"
					aria-label={`Shopping line ${lineIndex + 1} quantity`}
					className="h-10 w-14"
				/>
				<Input
					key={unitKey}
					{...unitProps}
					placeholder="Unit"
					aria-label={`Shopping line ${lineIndex + 1} unit`}
					className="h-10 w-16"
				/>
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					{...form.remove.getButtonProps({ name: linesName, index: lineIndex })}
					aria-label={`Remove shopping line ${lineIndex + 1}`}
				>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
			{/* Separate lists so each input's aria-describedby resolves */}
			<ErrorList errors={line.name.errors} id={line.name.errorId} />
			<ErrorList errors={line.quantity.errors} id={line.quantity.errorId} />
			<ErrorList errors={line.unit.errors} id={line.unit.errorId} />
		</li>
	)
}
