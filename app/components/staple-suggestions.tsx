import { useFetcher } from 'react-router'
import { householdIngredientKey } from '#app/utils/household-ingredient.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

/** Things most households keep; the first Staples are a tap each (#351). */
export const SUGGESTED_STAPLES = [
	'salt',
	'pepper',
	'olive oil',
	'garlic',
	'onions',
	'butter',
	'eggs',
	'milk',
	'flour',
	'sugar',
	'rice',
	'pasta',
	'soy sauce',
	'stock cubes',
	'tinned tomatoes',
]

type Response = { status: 'success' | 'error'; message?: string }

/**
 * Suggested Staples the household does not hold yet, each a one-tap add
 * through the page's own add-staple action. Renders nothing once every
 * suggestion is held.
 */
export function StapleSuggestions({
	held,
	heading,
	lead,
}: {
	held: string[]
	heading: string
	lead: string
}) {
	const heldKeys = new Set(held.map(householdIngredientKey))
	const remaining = SUGGESTED_STAPLES.filter(
		(name) => !heldKeys.has(householdIngredientKey(name)),
	)
	if (remaining.length === 0) return null
	return (
		<section
			aria-labelledby="staple-suggestions-heading"
			className="bg-muted/40 mt-5 rounded-lg p-5"
		>
			<h2
				id="staple-suggestions-heading"
				className="font-serif text-xl font-normal"
			>
				{heading}
			</h2>
			<p className="text-muted-foreground mt-1 text-sm">{lead}</p>
			<ul aria-label="Suggested Staples" className="mt-4 flex flex-wrap gap-2">
				{remaining.map((name) => (
					<li key={name}>
						<SuggestionChip name={name} />
					</li>
				))}
			</ul>
		</section>
	)
}

function SuggestionChip({ name }: { name: string }) {
	const fetcher = useFetcher<Response>()
	const pending = fetcher.state !== 'idle'
	const failed = fetcher.state === 'idle' && fetcher.data?.status === 'error'
	return (
		<fetcher.Form method="post">
			<input type="hidden" name="intent" value="add-staple" />
			<input type="hidden" name="displayName" value={name} />
			<Button
				type="submit"
				variant="outline"
				className="min-h-11 rounded-full"
				disabled={pending}
				aria-label={
					pending
						? `Adding ${name}`
						: failed
							? `Could not add ${name}, try again`
							: `Add ${name}`
				}
			>
				<Icon name={failed ? 'update' : 'plus'} size="sm" />
				{name}
			</Button>
		</fetcher.Form>
	)
}
