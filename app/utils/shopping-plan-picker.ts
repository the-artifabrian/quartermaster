/**
 * The Plan picker's line vocabulary (#288). From Plan no longer generates a
 * whole week in one shot: it opens a picker over the week's Meals, and the
 * household ticks what it actually wants to buy. These statuses are the only
 * reason a line arrives unticked — everything else is ticked for fewest taps.
 */
export type PlanPickerLineStatus =
	/** Nothing says otherwise: ticked by default. */
	| 'needed'
	/**
	 * This Meal's amount is already on Shopping: the Meal has a current
	 * Shopping contribution for this identity, on a checked row or not.
	 * Adding the Meal again would change nothing, so the line can't be
	 * ticked and never counts as picked.
	 */
	| 'added'
	/**
	 * A row with this name is on Shopping, but this Meal's amount isn't on
	 * it: a typed row, a Recipe-detail row or another Meal's. Ticking adds
	 * this Meal's amount.
	 */
	| 'name-on-list'
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
 * Why one demand line is or is not ticked by default. The Meal's own amount
 * on the list wins over everything: adding the Meal again would change
 * nothing. A row with the same name wins over "usually on hand": it is the
 * more concrete fact, and the household can check it by looking at the list.
 */
export function planPickerLineStatus({
	canonicalName,
	addedIdentities,
	listedIdentities,
	keptByAvailability,
	pantryStaple,
}: {
	canonicalName: string
	/** Identities this Meal has a current Shopping contribution for. */
	addedIdentities: ReadonlySet<string>
	/** Demand identities of every row currently on the Shopping list. */
	listedIdentities: ReadonlySet<string>
	/** Demand identities the availability seam kept for this Meal. */
	keptByAvailability: ReadonlySet<string>
	/** The ingredient heuristic recognises this as a plain pantry basic. */
	pantryStaple: boolean
}): PlanPickerLineStatus {
	if (addedIdentities.has(canonicalName)) return 'added'
	if (listedIdentities.has(canonicalName)) return 'name-on-list'
	if (!keptByAvailability.has(canonicalName) || pantryStaple) return 'on-hand'
	return 'needed'
}

/** The lines a tick can add: every line except this Meal's amounts on the list. */
export function pickableLines(lines: PlanPickerLine[]) {
	return lines.filter((line) => line.status !== 'added')
}

/**
 * What the Meal box shows. `done` is a Meal with nothing left to buy: some
 * of its lines are on the list already, and the rest are usually on hand and
 * not ticked. An on-hand line can still be ticked on its own, and the box
 * then counts the lines a tick can add, as it does for any other Meal. A
 * Meal with nothing on the list is never done, however much is on hand.
 */
export function mealPickState(
	lines: PlanPickerLine[],
	picked: ReadonlySet<string>,
): 'done' | 'all' | 'some' | 'none' {
	const pickable = pickableLines(lines)
	const count = pickable.filter((line) => picked.has(line.canonicalName)).length
	const nothingToBuy =
		pickable.length < lines.length &&
		pickable.every((line) => line.status === 'on-hand')
	if (count === 0) return nothingToBuy ? 'done' : 'none'
	return count === pickable.length ? 'all' : 'some'
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

/**
 * What the Meal box ticks next. An empty Meal fills with its default lines
 * first, so ticking a past Meal back does not drag in salt and rows already
 * on the list; a part-ticked Meal fills up; only a full one empties. Lines
 * the Meal already has on the list are never ticked.
 */
export function toggleMealPicks(
	lines: PlanPickerLine[],
	picked: ReadonlySet<string>,
): Set<string> {
	const state = mealPickState(lines, picked)
	if (state === 'done' || state === 'all') return new Set()
	if (state === 'none') {
		const needed = defaultPickedLines(lines)
		if (needed.length > 0) return new Set(needed)
	}
	return new Set(pickableLines(lines).map((line) => line.canonicalName))
}
