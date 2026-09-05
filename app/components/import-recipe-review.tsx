import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { type ExtractedRecipe } from '#app/routes/recipes/import.tsx'
import {
	IngredientFields,
	type IngredientFieldValue,
} from './ingredient-fields.tsx'
import {
	InstructionFields,
	type InstructionFieldValue,
} from './instruction-fields.tsx'
import { invalidateServiceWorkerData } from './service-worker-data-sync.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'
import { StatusButton } from './ui/status-button.tsx'
import { Textarea } from './ui/textarea.tsx'

function reviewFieldLabel(field: string) {
	const ingredient = field.match(/^ingredients\[(\d+)\]\.(.+)$/)
	if (ingredient)
		return `Ingredient ${Number(ingredient[1]) + 1} · ${ingredient[2]}`
	const instruction = field.match(/^instructions\[(\d+)\]/)
	if (instruction) return `Step ${Number(instruction[1]) + 1}`
	const labels: Record<string, string> = {
		title: 'Title',
		description: 'Description',
		ingredients: 'Ingredients',
		instructions: 'Instructions',
		activeTime: 'Active time',
		totalTime: 'Total time',
		yieldAmount: 'Yield amount',
		yieldLabel: 'What it makes',
		sourceUrl: 'Source URL',
	}
	return labels[field] ?? field
}

// Mounted once per explicit extraction. Save/revalidation never reinitializes it.
export function ImportRecipeReview({ recipe }: { recipe: ExtractedRecipe }) {
	const navigate = useNavigate()
	const [editing, setEditing] = useState(false)
	const [warnings, setWarnings] = useState(recipe.warnings ?? [])
	const [details, setDetails] = useState(() => ({
		title: recipe.title,
		description: recipe.description ?? '',
		activeTime: recipe.activeTime?.toString() ?? '',
		totalTime: recipe.totalTime?.toString() ?? '',
		yieldAmount: recipe.yieldAmount?.toString() ?? '',
		yieldLabel: recipe.yieldLabel ?? '',
		sourceUrl: recipe.sourceUrl,
	}))
	const titleInput = useRef<HTMLInputElement>(null)
	const overviewTitle = useRef<HTMLHeadingElement>(null)
	function toggleEditing() {
		setWarnings([])
		if (editing && Object.keys(errors).length > 0) {
			setErrors({})
			setMessage('')
		}
		setEditing(!editing)
		requestAnimationFrame(() => {
			if (editing) overviewTitle.current?.focus()
			else titleInput.current?.focus()
		})
	}
	const [ingredients, setIngredients] = useState<IngredientFieldValue[]>(
		recipe.ingredients,
	)
	const [instructions, setInstructions] = useState<InstructionFieldValue[]>(
		recipe.instructions,
	)
	const [errors, setErrors] = useState<Record<string, string[] | null>>({})
	const [message, setMessage] = useState('')
	const [saving, setSaving] = useState(false)
	const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null)
	const inFlight = useRef(false)
	const errorSummary = useRef<HTMLDivElement>(null)

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (inFlight.current || savedRecipeId) return
		const body = new FormData(event.currentTarget)
		ingredients.forEach((ingredient, index) => {
			for (const field of ['name', 'amount', 'unit', 'notes'] as const) {
				body.set(`ingredients[${index}].${field}`, ingredient[field] ?? '')
			}
			body.set(
				`ingredients[${index}].isHeading`,
				String(ingredient.isHeading ?? false),
			)
		})
		instructions.forEach((instruction, index) =>
			body.set(`instructions[${index}].content`, instruction.content),
		)
		inFlight.current = true
		setSaving(true)
		setErrors({})
		setMessage('')
		let confirmedId: string | null = null
		try {
			// A plain JSON response lets a transport failure keep this active form.
			// Never retry a create automatically: its outcome may be unknown.
			const response = await fetch('/resources/save-import', {
				method: 'POST',
				// Multipart encoding rewrites line endings in retained source.
				body: new URLSearchParams(
					Array.from(body, ([key, value]) => [key, String(value)]),
				),
				headers: { Accept: 'application/json' },
			})
			invalidateServiceWorkerData()
			const result = (await response.json()) as {
				recipeId?: string
				error?: string
				result?: { error?: Record<string, string[] | null> }
			}
			if (response.ok && typeof result.recipeId === 'string') {
				confirmedId = result.recipeId
				setSavedRecipeId(confirmedId)
				await navigate(`/recipes/${confirmedId}`)
				return
			}
			setErrors(result.result?.error ?? {})
			if (result.result?.error) setEditing(true)
			setMessage(
				result.error ||
					'Save could not be confirmed. Check My Recipes before trying again.',
			)
		} catch {
			invalidateServiceWorkerData()
			setMessage(
				confirmedId
					? 'Recipe saved. Open it below.'
					: 'Save could not be confirmed. Your corrections are still here. Check My Recipes before trying again.',
			)
		} finally {
			inFlight.current = false
			setSaving(false)
			requestAnimationFrame(() => errorSummary.current?.focus())
		}
	}

	return (
		<form method="post" noValidate onSubmit={save} className="space-y-6">
			<input type="hidden" name="intent" value="save" />
			<input type="hidden" name="rawText" value={recipe.rawText} />
			{message && (
				<div
					ref={errorSummary}
					tabIndex={-1}
					role="alert"
					className="text-destructive space-y-2"
				>
					<p>{message}</p>
					<ul>
						{Object.entries(errors).flatMap(
							([field, messages]) =>
								messages?.map((error) => (
									<li key={`${field}-${error}`}>
										{field ? `${reviewFieldLabel(field)}: ` : ''}
										{error}
									</li>
								)) ?? [],
						)}
					</ul>
					{!Object.entries(errors).some(
						([field, messages]) => field && messages?.length,
					) &&
						!savedRecipeId && (
							<Link to="/recipes" target="_blank" className="underline">
								Check My Recipes
							</Link>
						)}
				</div>
			)}
			{!editing && warnings.length ? (
				<p role="status">
					{warnings.join('. ')}. Choose Edit to add anything missing.
				</p>
			) : null}
			{savedRecipeId && (
				<Link to={`/recipes/${savedRecipeId}`} className="underline">
					Open saved Recipe
				</Link>
			)}
			<fieldset
				disabled={saving || !!savedRecipeId}
				className="min-w-0 space-y-6"
			>
				{!editing && (
					<div className="space-y-6" aria-label="Recipe overview">
						<div>
							<h2
								ref={overviewTitle}
								tabIndex={-1}
								className="font-serif text-2xl wrap-anywhere"
							>
								{details.title || 'Untitled Recipe'}
							</h2>
							{details.description && (
								<p className="text-muted-foreground mt-2 whitespace-pre-wrap">
									{details.description}
								</p>
							)}
							<div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
								{details.activeTime && (
									<span>Active: {details.activeTime} min</span>
								)}
								{details.totalTime && (
									<span>Total: {details.totalTime} min</span>
								)}
								{(details.yieldAmount || details.yieldLabel) && (
									<span>
										Makes {details.yieldAmount} {details.yieldLabel}
									</span>
								)}
							</div>
						</div>
						<section className="space-y-3">
							<h3 className="font-serif text-lg">Ingredients</h3>
							<ul className="space-y-2 wrap-anywhere">
								{ingredients.map((ingredient, index) => (
									<li key={index}>
										{ingredient.isHeading ? (
											<h4 className="border-border mt-4 border-b pb-1 font-medium">
												{ingredient.name}
											</h4>
										) : (
											<>
												{[ingredient.amount, ingredient.unit, ingredient.name]
													.filter(Boolean)
													.join(' ')}
												{ingredient.notes && (
													<span className="text-muted-foreground">
														, {ingredient.notes}
													</span>
												)}
											</>
										)}
									</li>
								))}
							</ul>
						</section>
						<section className="space-y-3">
							<h3 className="font-serif text-lg">Instructions</h3>
							<ol className="list-decimal space-y-3 pl-5 wrap-anywhere">
								{instructions.map((instruction, index) => (
									<li key={index} className="pl-1 whitespace-pre-wrap">
										{instruction.content}
									</li>
								))}
							</ol>
						</section>
					</div>
				)}
				{/* Keep controls mounted so switching views preserves every correction. */}
				<div hidden={!editing} className="space-y-6">
					<div className="space-y-2">
						<Label htmlFor="review-title">Title</Label>
						<Input
							ref={titleInput}
							id="review-title"
							name="title"
							value={details.title}
							onChange={(event) =>
								setDetails({ ...details, title: event.target.value })
							}
						/>
					</div>
					<section className="space-y-3">
						<h3 className="font-serif text-lg">Ingredients</h3>
						<IngredientFields
							allowRecipeLinks={false}
							ingredients={ingredients}
							onChange={setIngredients}
						/>
					</section>
					<section className="space-y-3">
						<h3 className="font-serif text-lg">Instructions</h3>
						<InstructionFields
							instructions={instructions}
							onChange={setInstructions}
						/>
					</section>
					<details open className="space-y-4">
						<summary className="min-h-11 cursor-pointer py-3">
							Recipe details
						</summary>
						<div className="space-y-2">
							<Label htmlFor="review-description">Description</Label>
							<Textarea
								id="review-description"
								name="description"
								value={details.description}
								onChange={(event) =>
									setDetails({ ...details, description: event.target.value })
								}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							{(
								[
									['activeTime', 'Active time (min)'],
									['totalTime', 'Total time (min)'],
									['yieldAmount', 'Yield amount'],
									['yieldLabel', 'What it makes'],
								] as const
							).map(([name, label]) => (
								<div key={name} className="space-y-2">
									<Label htmlFor={`review-${name}`}>{label}</Label>
									<Input
										id={`review-${name}`}
										name={name}
										type={name === 'yieldLabel' ? 'text' : 'number'}
										step={name === 'yieldAmount' ? 'any' : '1'}
										value={details[name]}
										onChange={(event) =>
											setDetails({ ...details, [name]: event.target.value })
										}
									/>
								</div>
							))}
						</div>
						<div className="space-y-2">
							<Label htmlFor="review-sourceUrl">Source URL</Label>
							<Input
								id="review-sourceUrl"
								name="sourceUrl"
								value={details.sourceUrl}
								onChange={(event) =>
									setDetails({ ...details, sourceUrl: event.target.value })
								}
							/>
						</div>
					</details>
					<details>
						<summary className="min-h-11 cursor-pointer py-3">
							Original input
						</summary>
						<pre className="font-sans text-base wrap-anywhere whitespace-pre-wrap">
							{recipe.rawText}
						</pre>
					</details>
				</div>
				<div className="flex flex-wrap justify-end gap-3">
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							if (
								window.confirm('Discard this review and start another import?')
							)
								window.location.assign('/recipes/import')
						}}
					>
						Discard review
					</Button>
					<Button type="button" variant="outline" onClick={toggleEditing}>
						{editing ? 'Done editing' : 'Edit'}
					</Button>
					<StatusButton
						type="submit"
						disabled={saving}
						status={saving ? 'pending' : 'idle'}
					>
						Save Recipe
					</StatusButton>
				</div>
			</fieldset>
		</form>
	)
}
