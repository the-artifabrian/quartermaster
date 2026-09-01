type TitledRecipe = { title: string }
type SearchableRecipe = TitledRecipe & {
	description?: string | null
	ingredients?: readonly { name: string }[]
}

const MAX_SEARCH_QUERY_LENGTH = 256
const MAX_SEARCH_TERMS = 8

function normalizeSearchText(value: string) {
	return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

function searchTerms(query: string) {
	return normalizeSearchText(query.slice(0, MAX_SEARCH_QUERY_LENGTH))
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_SEARCH_TERMS)
}

function isOneEditAway(term: string, word: string) {
	if (Math.abs(term.length - word.length) > 1) return false

	if (term.length === word.length) {
		const mismatches: number[] = []
		for (let index = 0; index < term.length; index++) {
			if (term[index] !== word[index]) mismatches.push(index)
			if (mismatches.length > 2) return false
		}
		if (mismatches.length <= 1) return true
		const [first, second] = mismatches
		return (
			second === first! + 1 &&
			term[first!] === word[second!] &&
			term[second!] === word[first!]
		)
	}

	const shorter = term.length < word.length ? term : word
	const longer = term.length < word.length ? word : term
	let shorterIndex = 0
	let longerIndex = 0
	let edits = 0
	while (shorterIndex < shorter.length && longerIndex < longer.length) {
		if (shorter[shorterIndex] === longer[longerIndex]) {
			shorterIndex++
			longerIndex++
		} else {
			edits++
			longerIndex++
			if (edits > 1) return false
		}
	}
	return true
}

function titleMatchRank(title: string, terms: string[]) {
	const normalizedTitle = normalizeSearchText(title)
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.join(' ')
	const normalizedQuery = terms.join(' ')
	if (normalizedTitle === normalizedQuery) return 0
	if (normalizedTitle.includes(normalizedQuery)) return 1
	if (terms.every((term) => normalizedTitle.includes(term))) return 2

	const words = normalizedTitle.split(' ')
	if (
		terms.every((term) =>
			words.some(
				(word) =>
					word.includes(term) ||
					(term.length >= 4 && word.length >= 4 && isOneEditAway(term, word)),
			),
		)
	) {
		return 3
	}

	return null
}

export function rankRecipeTitleMatches<T extends TitledRecipe>(
	recipes: readonly T[],
	query: string,
): T[] {
	const terms = searchTerms(query)
	if (terms.length === 0) return [...recipes]

	return recipes
		.map((recipe, index) => ({
			recipe,
			index,
			rank: titleMatchRank(recipe.title, terms),
		}))
		.filter(
			(result): result is typeof result & { rank: number } =>
				result.rank !== null,
		)
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(({ recipe }) => recipe)
}

export function rankRecipeSearchMatches<T extends SearchableRecipe>(
	recipes: readonly T[],
	query: string,
): T[] {
	const terms = searchTerms(query)
	if (terms.length === 0) return [...recipes]

	return recipes
		.map((recipe, index) => {
			const titleRank = titleMatchRank(recipe.title, terms)
			if (titleRank !== null) return { recipe, index, rank: titleRank }

			const fields = [
				recipe.title,
				recipe.description ?? '',
				...(recipe.ingredients ?? []).map((ingredient) => ingredient.name),
			].map(normalizeSearchText)
			const matchesFields = terms.every((term) =>
				fields.some((field) => field.includes(term)),
			)
			return { recipe, index, rank: matchesFields ? 4 : null }
		})
		.filter(
			(result): result is typeof result & { rank: number } =>
				result.rank !== null,
		)
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(({ recipe }) => recipe)
}
