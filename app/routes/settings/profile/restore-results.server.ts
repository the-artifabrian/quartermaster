// What a restore counts and logs, shared by the restore modules.

// Skipped means the Household already has it. Errored means it is in the
// file but couldn't be restored.
export type RestoreCounts = {
	created: number
	skipped: number
	errored: number
}

export interface ImportResults {
	recipes: RestoreCounts
	menus: RestoreCounts
	recipeMetadataValues: { created: number; skipped: number }
	householdIngredients: { created: number; skipped: number }
	mealPlans: RestoreCounts
	meals: RestoreCounts
	shoppingLists: { created: number; skipped: number }
}

/**
 * One thing in the file that a restore couldn't bring back. It is counted in
 * the result the user sees and logged with where it sits in the file. The log
 * never carries the user's own text, and neither does a Prisma error message,
 * which can quote the values it was given.
 */
export interface RestoreFailure {
	/** Where it sits in the file, such as `mealPlans[2].meals[5]`. */
	at: string
	reason:
		| 'invalid-date'
		| 'invalid-week'
		// A real day, but not in the week of the plan it sits in.
		| 'outside-week'
		| 'nothing-to-restore'
		| 'recipe-not-in-file'
		| 'write-refused'
		// A Shopping item's link to a Meal deleted while the restore ran.
		| 'meal-gone'
	/** How many items it stands for, when a whole week fails at once. */
	count?: number
	/** The Prisma error code, for a write the database refused. */
	code?: string
}

export type RecordFailure = (failure: RestoreFailure) => void

/**
 * The write errors a restore counts as one failed item: the database refused
 * the row over a constraint. Mostly that is a row it points at being deleted
 * while the restore ran (P2003, P2025), or the same unique row saved at the
 * same moment (P2002). The libSQL adapter reports every SQLite constraint
 * failure as P2003, a trigger's abort included. Anything else is unexpected,
 * and the restore stops with it. Running the restore again skips what it
 * already saved and picks up the rest.
 */
export function refusedWriteCode(error: unknown) {
	const code = (error as { code?: unknown } | null)?.code
	return code === 'P2002' || code === 'P2003' || code === 'P2025' ? code : null
}
