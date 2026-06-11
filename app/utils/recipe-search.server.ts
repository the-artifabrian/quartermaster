import { type Prisma } from '#app/generated/prisma/client.ts'

// Each term adds a LIKE per field plus an EXISTS subquery on Ingredient, so
// cap the term count to keep pasted-sentence queries from ballooning the SQL.
const MAX_SEARCH_TERMS = 8

function searchTerms(query: string) {
	return query.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS)
}

/**
 * Where-clause fragment for the recipes-page search box.
 *
 * The query is split into words and every word must match, but each word may
 * match in any field (title, description, or an ingredient name) — so
 * "pea stew" finds "Pea and Carrot Stew" even though the words aren't
 * adjacent in the title.
 */
export function recipeSearchWhere(search: string): Prisma.RecipeWhereInput {
	const terms = searchTerms(search)
	if (terms.length === 0) return {}
	return {
		AND: terms.map((term) => ({
			OR: [
				{ title: { contains: term } },
				{ description: { contains: term } },
				{ ingredients: { some: { name: { contains: term } } } },
			],
		})),
	}
}

/**
 * Title-only variant for the recipe-selector typeahead. Same per-word
 * semantics as {@link recipeSearchWhere}, but scoped to the title so the
 * dropdown isn't flooded with ingredient-only matches.
 */
export function recipeTitleSearchWhere(query: string): Prisma.RecipeWhereInput {
	const terms = searchTerms(query)
	if (terms.length === 0) return {}
	return { AND: terms.map((term) => ({ title: { contains: term } })) }
}
