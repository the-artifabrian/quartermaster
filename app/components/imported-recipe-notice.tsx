import { useEffect } from 'react'
import { Form, Link, useNavigation } from 'react-router'
import {
	type ImportedFrom,
	type ShortenedPart,
} from '#app/utils/import-recipe-types.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { haptic } from '#app/utils/shell-bridge.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { StatusButton } from './ui/status-button.tsx'

const shortenedLabels: Record<ShortenedPart, string> = {
	title: 'the title',
	description: 'the description',
	notes: 'the notes',
	ingredients: 'some ingredients',
	instructions: 'some instructions',
	yield: 'what it makes',
}

function listed(items: string[]) {
	if (items.length <= 1) return items.join('')
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function fromLabel(from: ImportedFrom, sourceUrl: string | null) {
	if (from === 'images') return 'From your screenshots'
	if (from === 'text') return 'From your text'
	try {
		return `From ${new URL(sourceUrl ?? '').hostname.replace(/^www\./, '')}`
	} catch {
		return 'From a link'
	}
}

/**
 * The first thing a just-imported Recipe says: that it is already saved, what
 * the import could not find or had to shorten, and what to do next.
 */
export function ImportedRecipeNotice({
	recipeId,
	from,
	sourceUrl,
	shortened,
	missingIngredients,
	missingInstructions,
	sameTitle,
	onDismiss,
}: {
	recipeId: string
	from: ImportedFrom
	sourceUrl: string | null
	shortened: ShortenedPart[]
	missingIngredients: boolean
	missingInstructions: boolean
	sameTitle: { id: string; title: string } | null
	onDismiss: () => void
}) {
	const undoCheck = useDoubleCheck()
	const navigation = useNavigation()
	const undoing =
		navigation.formAction === `/recipes/${recipeId}/edit` &&
		navigation.formData?.get('undo') === 'import'
	const missing =
		missingIngredients && missingInstructions
			? 'the ingredients or instructions'
			: missingIngredients
				? 'the ingredients'
				: missingInstructions
					? 'the instructions'
					: null
	const needsEdit = Boolean(missing) || shortened.length > 0

	useEffect(() => {
		haptic('success')
	}, [recipeId])

	return (
		<section
			aria-labelledby="imported-recipe-notice"
			className="bg-muted/40 mb-5 rounded-lg p-4 print:hidden"
		>
			<div className="flex items-start gap-3">
				<Icon
					name="check"
					className="text-primary mt-0.5 size-5 shrink-0 self-start"
				/>
				<div className="min-w-0 flex-1 space-y-1" role="status">
					<h2 id="imported-recipe-notice" className="font-medium">
						Saved to your Recipes
					</h2>
					<p className="text-muted-foreground text-sm">
						{fromLabel(from, sourceUrl)}
					</p>
					{missing ? (
						<p className="text-sm">
							We couldn’t find {missing}. Add them with Edit.
						</p>
					) : null}
					{shortened.length ? (
						<p className="text-sm">
							We shortened{' '}
							{listed(shortened.map((part) => shortenedLabels[part]))} to fit.
						</p>
					) : null}
					{sameTitle ? (
						<p className="text-sm">
							You already had a Recipe with this title.{' '}
							<Link
								to={`/recipes/${sameTitle.id}`}
								className="text-primary underline underline-offset-4"
							>
								Open it
							</Link>
						</p>
					) : null}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="-mt-2 -mr-2 shrink-0"
					onClick={onDismiss}
				>
					<Icon name="cross-1" className="size-4" />
					<span className="sr-only">Dismiss</span>
				</Button>
			</div>
			<div className="mt-3 flex flex-wrap gap-2 pl-8">
				<Button
					asChild
					size="sm"
					className="min-h-11"
					variant={needsEdit ? 'default' : 'outline'}
				>
					<Link to={`/recipes/${recipeId}/edit`}>Edit</Link>
				</Button>
				<Button asChild size="sm" variant="outline" className="min-h-11">
					<Link to="/recipes/import">Import another</Link>
				</Button>
				{/* Replaces this Recipe in history, so Back cannot return to it. */}
				<Form method="POST" action={`/recipes/${recipeId}/edit`} replace>
					<input type="hidden" name="intent" value="delete" />
					<input type="hidden" name="undo" value="import" />
					<StatusButton
						{...undoCheck.getButtonProps({ type: 'submit' })}
						size="sm"
						className="min-h-11"
						variant={undoCheck.doubleCheck ? 'destructive' : 'ghost'}
						status={undoing ? 'pending' : 'idle'}
						disabled={undoing}
					>
						{undoCheck.doubleCheck ? 'Delete?' : 'Undo'}
					</StatusButton>
				</Form>
			</div>
		</section>
	)
}
