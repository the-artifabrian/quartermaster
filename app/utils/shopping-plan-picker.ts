/**
 * The Plan picker's line vocabulary (#288). From Plan no longer generates a
 * whole week in one shot: it opens a picker over the week's Meals, and the
 * household ticks what it actually wants to buy. These statuses are the only
 * reason a line arrives unticked — everything else is ticked for fewest taps.
 */
export type PlanPickerLineStatus =
	/** Nothing says otherwise: ticked by default. */
	| 'needed'
	/** A row with this identity is already on the Shopping list. */
	| 'on-list'
	/**
	 * The household normally has this: one of its Staples, or one of the plain
	 * basics the ingredient heuristic recognises (water, salt, pepper, plain
	 * oils). Adding a Meal from Plan already omits the first; the picker
	 * leaves the second unticked too, rather than asking the household to
	 * untick salt every week.
	 */
	| 'on-hand'

export type PlanPickerLine = {
	/** Demand identity — what the tick set and the writer key on. */
	canonicalName: string
	name: string
	quantity: string | null
	unit: string | null
	status: PlanPickerLineStatus
}

export type PlanPickerMeal = {
	id: string
	title: string
	/** Familiar label ("Dinner"), when it is not already the title. */
	label: string | null
	/** Every Recipe card on the Meal, in Plan order. */
	recipeTitles: string[]
	lines: PlanPickerLine[]
}

export type PlanPickerDay = {
	date: string
	/** "Sat 26": the prefix each of the day's Meal headings carries. */
	label: string
	meals: PlanPickerMeal[]
}

/**
 * Why one demand line is or is not ticked by default. "Already on list" wins
 * over "usually on hand": it is the more concrete fact, and it is the one the
 * household can act on by looking at the list.
 */
export function planPickerLineStatus({
	canonicalName,
	listedIdentities,
	keptByAvailability,
	pantryStaple,
}: {
	canonicalName: string
	/** Demand identities of every row currently on the Shopping list. */
	listedIdentities: ReadonlySet<string>
	/** Demand identities the availability seam kept for this Meal. */
	keptByAvailability: ReadonlySet<string>
	/** The ingredient heuristic recognises this as a plain pantry basic. */
	pantryStaple: boolean
}): PlanPickerLineStatus {
	if (listedIdentities.has(canonicalName)) return 'on-list'
	if (!keptByAvailability.has(canonicalName) || pantryStaple) return 'on-hand'
	return 'needed'
}

/**
 * Lines a picker group ticks by default. A Meal on a day already gone starts
 * with nothing ticked: by Tuesday, Monday's dinner was either cooked or
 * skipped, and ticking its lines would pad the shop with food for a day that
 * is over. The household can still tick the Meal back in one tap when it was
 * only postponed.
 */
export function defaultPickedLines(
	lines: PlanPickerLine[],
	{ past = false }: { past?: boolean } = {},
): string[] {
	if (past) return []
	return lines
		.filter((line) => line.status === 'needed')
		.map((line) => line.canonicalName)
}
