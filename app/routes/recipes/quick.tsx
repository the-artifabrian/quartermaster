import {
	getFormProps,
	getInputProps,
	getTextareaProps,
	useForm,
} from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data,
	redirect,
	Form,
	useActionData,
	useNavigation,
} from 'react-router'
import { Field, TextareaField } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { parseRecipeText } from '#app/utils/bulk-recipe-parser.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { QuickRecipeSchema } from '#app/utils/recipe-validation.ts'
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

	// Parse the raw text to extract structured ingredients and instructions
	const parsed = parseRecipeText(`${title}\n\n${rawText}`)

	const recipe = await prisma.recipe.create({
		data: {
			title,
			description: parsed.description,
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

	return redirect(`/recipes/${recipe.id}`)
}

export default function QuickRecipeEntry() {
	const actionData = useActionData<{
		result: { error?: Record<string, string[]> }
	}>()
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'

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
		<div className="container max-w-2xl py-6 pb-20 md:pb-6">
			<h1 className="mb-6 text-2xl font-bold">Quick Entry</h1>
			<p className="text-muted-foreground mb-6">
				Paste or type a recipe as freeform text. You can add structure later by
				editing.
			</p>
			<Form method="POST" {...getFormProps(form)} className="space-y-6">
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
