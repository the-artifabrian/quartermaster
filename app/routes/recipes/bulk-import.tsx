import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { data, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	parseRecipeText,
	splitMultipleRecipes,
	type ParsedRecipe,
} from '#app/utils/bulk-recipe-parser.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { useDebounce } from '#app/utils/misc.tsx'
import { type Route } from './+types/bulk-import.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Bulk Import | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

const BulkImportIngredientSchema = z.object({
	name: z.string().min(1).max(200),
	amount: z.string().max(50).optional(),
	unit: z.string().max(50).optional(),
	notes: z.string().max(500).optional(),
})

const BulkImportRecipeSchema = z.object({
	title: z.string().min(1).max(100),
	description: z.string().max(500).optional(),
	ingredients: z.array(BulkImportIngredientSchema).max(200),
	instructions: z.array(z.object({ content: z.string().min(1).max(5000) })).max(200),
})

const BulkImportPayloadSchema = z
	.array(BulkImportRecipeSchema)
	.min(1)
	.max(50)

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const rawJson = formData.get('recipes')

	if (typeof rawJson !== 'string') {
		return data(
			{ created: 0, errors: [{ title: 'Unknown', error: 'Invalid payload' }] },
			{ status: 400 },
		)
	}

	let recipes: z.infer<typeof BulkImportPayloadSchema>
	try {
		const parsed = JSON.parse(rawJson)
		recipes = BulkImportPayloadSchema.parse(parsed)
	} catch {
		return data(
			{
				created: 0,
				errors: [{ title: 'Unknown', error: 'Invalid recipe data' }],
			},
			{ status: 400 },
		)
	}

	const created: string[] = []
	const errors: Array<{ title: string; error: string }> = []

	for (const recipe of recipes) {
		try {
			await prisma.recipe.create({
				data: {
					title: recipe.title,
					description: recipe.description || null,
					userId,
					householdId,
					ingredients: {
						create: recipe.ingredients.map((ing, order) => ({
							name: ing.name,
							amount: ing.amount || null,
							unit: ing.unit || null,
							notes: ing.notes || null,
							order,
						})),
					},
					instructions: {
						create: recipe.instructions.map((inst, order) => ({
							content: inst.content,
							order,
						})),
					},
				},
			})
			created.push(recipe.title)
		} catch (err) {
			errors.push({
				title: recipe.title,
				error: err instanceof Error ? err.message : 'Unknown error',
			})
		}
	}

	if (created.length > 0) {
		void emitHouseholdEvent({
			type: 'recipes_bulk_imported',
			payload: { count: created.length },
			userId,
			householdId,
		})
	}

	return { created: created.length, errors }
}

export default function BulkImport() {
	const fetcher = useFetcher<typeof action>()
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const [previews, setPreviews] = useState<ParsedRecipe[]>([])
	const [sessionCount, setSessionCount] = useState(0)

	const isSubmitting = fetcher.state === 'submitting'

	const handleChange = useDebounce((value: string) => {
		if (!value.trim()) {
			setPreviews([])
			return
		}
		const chunks = splitMultipleRecipes(value)
		setPreviews(chunks.map(parseRecipeText))
	}, 300)

	// Handle fetcher completion — toast + clear are external side effects
	const lastFetcherData = useRef(fetcher.data)
	useEffect(() => {
		if (!fetcher.data || fetcher.data === lastFetcherData.current) return
		lastFetcherData.current = fetcher.data
		const { created, errors } = fetcher.data
		if (created > 0) {
			setSessionCount((prev) => prev + created)
			toast.success(
				`Imported ${created} recipe${created === 1 ? '' : 's'}`,
			)
			if (textareaRef.current) {
				textareaRef.current.value = ''
				textareaRef.current.focus()
			}
			setPreviews([])
		}
		if (errors.length > 0) {
			toast.error(
				`Failed to import ${errors.length}: ${errors.map((e) => e.title).join(', ')}`,
			)
		}
	}, [fetcher.data])

	const validPreviews = previews.filter(
		(p) => p.title && p.ingredients.length > 0,
	)

	function handleSubmit() {
		const payload = validPreviews.map((p) => ({
			title: p.title,
			description: p.description,
			ingredients: p.ingredients,
			instructions: p.instructions,
		}))
		const formData = new FormData()
		formData.set('recipes', JSON.stringify(payload))
		void fetcher.submit(formData, { method: 'POST' })
	}

	return (
		<div className="container max-w-2xl py-6">
			<Link
				to="/recipes"
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
			>
				<Icon name="arrow-left" size="sm" />
				Back to recipes
			</Link>
			<h1 className="mb-2 text-2xl font-bold">Bulk Import</h1>
			<p className="text-muted-foreground mb-6">
				Paste a recipe from Apple Notes (or any plain text). Use{' '}
				<code className="bg-muted rounded px-1.5 py-0.5 text-xs">---</code> to
				separate multiple recipes. Max 50 per batch.
			</p>

			{sessionCount > 0 && (
				<div className="bg-accent/10 text-accent-foreground mb-4 rounded-lg px-4 py-2 text-sm">
					{sessionCount} recipe{sessionCount === 1 ? '' : 's'} imported this
					session
				</div>
			)}

			<textarea
				ref={textareaRef}
				rows={16}
				autoFocus
				className="bg-background border-input placeholder:text-muted-foreground mb-4 w-full rounded-lg border p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
				placeholder={`Chicken Stir Fry

Ingredients
- 2 cups chicken breast, diced
- 1 tbsp soy sauce
- 3 cloves garlic

Instructions
1. Heat oil in a pan.
2. Add chicken and cook until browned.
3. Add garlic and soy sauce.

---

(paste another recipe here)`}
				onChange={(e) => handleChange(e.target.value)}
			/>

			{/* Preview */}
			{previews.length > 0 && (
				<div className="mb-4 space-y-3">
					<h2 className="text-sm font-medium">
						Preview ({previews.length} recipe
						{previews.length === 1 ? '' : 's'})
					</h2>
					{previews.map((recipe, i) => (
						<div
							key={i}
							className="border-border bg-card rounded-lg border p-4"
						>
							<div className="flex items-start justify-between gap-2">
								<div>
									<h3 className="font-medium">
										{recipe.title || (
											<span className="text-muted-foreground italic">
												No title
											</span>
										)}
									</h3>
									{recipe.description && (
										<p className="text-muted-foreground mt-0.5 text-sm">
											{recipe.description}
										</p>
									)}
									<p className="text-muted-foreground mt-1 text-xs">
										{recipe.ingredients.length} ingredient
										{recipe.ingredients.length === 1 ? '' : 's'}
										{' · '}
										{recipe.instructions.length} step
										{recipe.instructions.length === 1 ? '' : 's'}
									</p>
								</div>
								{recipe.warnings.length > 0 && (
									<div className="shrink-0">
										<Icon
											name="question-mark-circled"
											className="text-amber-500"
											size="sm"
										/>
									</div>
								)}
							</div>
							{recipe.warnings.length > 0 && (
								<div className="mt-2 space-y-1">
									{recipe.warnings.map((w, j) => (
										<p
											key={j}
											className="text-xs text-amber-600 dark:text-amber-400"
										>
											{w}
										</p>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			<div className="flex justify-end gap-3">
				<Button variant="outline" asChild>
					<Link to="/recipes">Cancel</Link>
				</Button>
				<StatusButton
					type="button"
					status={isSubmitting ? 'pending' : 'idle'}
					disabled={validPreviews.length === 0 || isSubmitting}
					onClick={handleSubmit}
				>
					{isSubmitting
						? 'Importing...'
						: `Import ${validPreviews.length} Recipe${validPreviews.length === 1 ? '' : 's'}`}
				</StatusButton>
			</div>
		</div>
	)
}
