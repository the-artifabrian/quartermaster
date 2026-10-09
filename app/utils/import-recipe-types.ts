export type ExtractedRecipe = {
	rawText: string
	title: string
	description: string | null
	/** The cook's own tips — only the AI extraction paths produce these. */
	notes: string | null
	activeTime: number | null
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	sourceUrl: string
	/**
	 * Household values the extraction matched, saved as the Recipe's
	 * classification. Only the AI paths produce these.
	 */
	metadataValueIds: string[]
	ingredients: Array<{
		name: string
		amount?: string
		unit?: string
		notes?: string
		isHeading?: boolean
	}>
	instructions: Array<{ content: string }>
}

/** Where an import came from, as the Recipe page's notice names it. */
export const IMPORTED_FROM = ['url', 'text', 'images'] as const
export type ImportedFrom = (typeof IMPORTED_FROM)[number]

/**
 * What an import had to shorten, or leave rows out of, to save, in the order
 * the Recipe page's notice lists them.
 */
export const SHORTENED_PARTS = [
	'title',
	'description',
	'notes',
	'ingredients',
	'instructions',
	'yield',
] as const
export type ShortenedPart = (typeof SHORTENED_PARTS)[number]
