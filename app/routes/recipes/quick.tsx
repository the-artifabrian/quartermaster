import {
	getFormProps,
	getInputProps,
	getTextareaProps,
	useForm,
} from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data,
	redirect,
	Form,
	useActionData,
	useNavigation,
} from 'react-router'
import { z } from 'zod'
import { ErrorList, Field, TextareaField } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { parseRecipeText } from '#app/utils/bulk-recipe-parser.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	QuickRecipeSchema,
	IngredientSchema,
	InstructionSchema,
	RecipeDescriptionSchema,
} from '#app/utils/recipe-validation.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/quick.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Quick Recipe | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()

	const submission = parseWithZod(formData, { schema: QuickRecipeSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const { title, rawText } = submission.value

	// Keep the submitted material before normalization or title/yield extraction.
	const originalText = `${title}\n\n${rawText}`
	const parsed = parseRecipeText(originalText)
	// Unstructured input belongs in Original input, not a second expanded Recipe.
	const description =
		parsed.ingredients.length || parsed.instructions.length
			? parsed.description
			: undefined
	const content = z
		.object({
			description: RecipeDescriptionSchema,
			ingredients: z.array(IngredientSchema).max(200),
			instructions: z.array(InstructionSchema).max(200),
		})
		.safeParse({ ...parsed, description })
	if (!content.success) {
		return data(
			{
				result: submission.reply({
					formErrors: [
						`Some extracted content exceeds the Recipe editor limits: ${content.error.issues[0]!.message}. Shorten or split that content and save again. Your input is still here.`,
					],
				}),
			},
			{ status: 400 },
		)
	}

	let recipe: { id: string }
	try {
		recipe = await prisma.recipe.create({
			data: {
				title,
				rawText: originalText,
				description,
				yieldAmount: parsed.yieldAmount,
				yieldLabel: parsed.yieldLabel,
				userId,
				householdId,
				ingredients:
					parsed.ingredients.length > 0
						? {
								create: parsed.ingredients.map((ing, i) => ({
									name: ing.name,
									amount: ing.amount ?? null,
									unit: ing.unit ?? null,
									notes: ing.notes ?? null,
									isHeading: ing.isHeading ?? false,
									order: i,
								})),
							}
						: undefined,
				instructions:
					parsed.instructions.length > 0
						? {
								create: parsed.instructions.map((inst, i) => ({
									content: inst.content,
									order: i,
								})),
							}
						: undefined,
			},
			select: { id: true },
		})
	} catch {
		return data(
			{
				result: submission.reply({
					formErrors: [
						'We could not confirm the save. Your input is still here. Check My Recipes before trying again.',
					],
				}),
			},
			{ status: 500 },
		)
	}

	const missing = [
		!parsed.ingredients.length && 'ingredients',
		!parsed.instructions.length && 'instructions',
	].filter(Boolean)
	if (missing.length) {
		return redirectWithToast(`/recipes/${recipe.id}`, {
			type: 'message',
			title: 'Original input saved',
			description: `Could not identify ${missing.join(' or ')}. Open Original input and edit the Recipe to add them.`,
		})
	}

	return redirect(`/recipes/${recipe.id}`)
}

export default function QuickRecipeEntry() {
	const actionData = useActionData<{
		result: { error?: Record<string, string[]> }
	}>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state !== 'idle'

	const [form, fields] = useForm({
		constraint: getZodConstraint(QuickRecipeSchema),
		lastResult: actionData?.result as any,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: QuickRecipeSchema })
		},
		shouldRevalidate: 'onBlur',
		shouldValidate: 'onSubmit',
	})

	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">Quick Entry</h1>
			<p className="text-muted-foreground mb-6">
				Paste or type a recipe as freeform text. You can add structure later by
				editing.
			</p>
			<Form
				method="POST"
				{...getFormProps(form)}
				className="space-y-6"
				onSubmitCapture={(event) => {
					if (isSubmitting) event.preventDefault()
				}}
			>
				<ErrorList id={form.errorId} errors={form.errors} />
				<Field
					labelProps={{ children: 'Title' }}
					inputProps={{
						...getInputProps(fields.title, { type: 'text' }),
						placeholder: 'Recipe title',
						autoFocus: true,
					}}
					errors={fields.title.errors}
				/>
				<TextareaField
					labelProps={{ children: 'Recipe Text' }}
					textareaProps={{
						...getTextareaProps(fields.rawText),
						placeholder:
							'Paste your recipe here — ingredients, instructions, notes, anything...',
						rows: 16,
					}}
					errors={fields.rawText.errors}
				/>
				<div className="flex justify-end gap-4">
					<Button
						type="button"
						variant="outline"
						onClick={() => history.back()}
					>
						Cancel
					</Button>
					<StatusButton
						type="submit"
						status={isSubmitting ? 'pending' : 'idle'}
						disabled={isSubmitting}
					>
						Save Recipe
					</StatusButton>
				</div>
			</Form>
		</div>
	)
}
