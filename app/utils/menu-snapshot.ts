/**
 * Pure mapping from a loaded Menu to the Meal snapshot seed (#107).
 *
 * Planning copies the Menu into one Meal exactly as the Menu reads today:
 * section order, Recipe/note card order, display identity, per-Recipe scale
 * multipliers, display notes, and note Shopping lines — all frozen. Guest
 * count is planning context only and never touches a multiplier. The copy is
 * by value, so later Menu edits cannot mutate the planned event; canonical
 * Recipe ingredients/instructions stay live through the kept recipeId.
 */

export type MenuForSnapshot = {
	sections: Array<{
		name: string | null
		items: Array<{
			kind: string
			recipeTitle: string | null
			scaleMultiplier: number | null
			note: string | null
			recipe: { id: string; title: string; householdId: string | null } | null
			shoppingLines: Array<{
				name: string
				quantity: string | null
				unit: string | null
			}>
		}>
	}>
}

export type SnapshotSectionSeed = {
	name: string | null
	items: Array<
		| {
				kind: 'recipe'
				recipeId: string | null
				recipeTitle: string
				scaleMultiplier: number
				note: string | null
				cooked?: boolean
		  }
		| {
				kind: 'note'
				text: string
				shoppingLines: Array<{
					name: string
					quantity: string | null
					unit: string | null
				}>
		  }
	>
}

/**
 * `householdId` guards the Recipe references the same way Menu detail does: a
 * reference outside the household freezes as a missing card, never a link.
 * Deleted Recipes (null reference) also freeze as missing cards with their
 * frozen Menu title, requiring explicit replacement/removal on the Meal.
 */
export function menuToSnapshotSections(
	menu: MenuForSnapshot,
	householdId: string,
): SnapshotSectionSeed[] {
	return menu.sections.map((section) => ({
		name: section.name,
		items: section.items.flatMap<SnapshotSectionSeed['items'][number]>(
			(item) => {
				if (item.kind === 'note') {
					const text = item.note?.trim()
					if (!text) return []
					return [
						{
							kind: 'note',
							text,
							shoppingLines: item.shoppingLines.map((line) => ({
								name: line.name,
								quantity: line.quantity,
								unit: line.unit,
							})),
						},
					]
				}
				const recipe =
					item.recipe && item.recipe.householdId === householdId
						? item.recipe
						: null
				// Freeze the identity the Menu displays: the live Recipe title when
				// the reference resolves, the frozen card title otherwise. A card
				// with neither cannot be represented and is dropped.
				const recipeTitle = recipe?.title ?? item.recipeTitle
				if (recipeTitle == null) return []
				return [
					{
						kind: 'recipe',
						recipeId: recipe?.id ?? null,
						recipeTitle,
						// Copied unchanged (#98 story 46) — guest count never silently
						// scales fixed or batch-like dishes.
						scaleMultiplier: item.scaleMultiplier ?? 1,
						note: item.note,
					},
				]
			},
		),
	}))
}

/** A Menu with no representable cards has nothing to plan. */
export function snapshotHasContent(sections: SnapshotSectionSeed[]): boolean {
	return sections.some((section) => section.items.length > 0)
}

/**
 * Regroup stored snapshot rows into their frozen section structure: for each
 * section in order, its Recipe and note cards interleaved by the order
 * sequence the two tables share. Unsectioned rows (planner-created items,
 * later additions) are the caller's — this returns sectioned content only.
 */
export function groupSnapshotEntries<
	R extends { sectionId: string | null; order: number },
	N extends { sectionId: string | null; order: number },
>(
	sections: Array<{ id: string; name: string | null }>,
	recipeItems: R[],
	noteItems: N[],
): Array<{
	id: string
	name: string | null
	entries: Array<{ kind: 'recipe'; item: R } | { kind: 'note'; item: N }>
}> {
	return sections.map((section) => {
		const entries: Array<{
			order: number
			entry: { kind: 'recipe'; item: R } | { kind: 'note'; item: N }
		}> = [
			...recipeItems
				.filter((item) => item.sectionId === section.id)
				.map((item) => ({
					order: item.order,
					entry: { kind: 'recipe' as const, item },
				})),
			...noteItems
				.filter((item) => item.sectionId === section.id)
				.map((item) => ({
					order: item.order,
					entry: { kind: 'note' as const, item },
				})),
		]
		return {
			id: section.id,
			name: section.name,
			entries: entries
				.sort((a, b) => a.order - b.order)
				.map(({ entry }) => entry),
		}
	})
}
