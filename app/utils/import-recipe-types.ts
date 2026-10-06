export type ExtractedRecipe = {
	rawText: string
	warnings?: string[]
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
	 * Household values the extraction matched, pre-ticked on the review page.
	 * Only the AI paths produce these, and nothing is written until the save.
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

export type DuplicateMatch = {
	id: string
	title: string
	sourceUrl: string | null
	matchReason: 'same-url' | 'similar-title'
}
