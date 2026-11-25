// Restores the Menus in an export file.

import { type z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import {
	type ImportMenuItemSchema,
	type ImportMenuSchema,
} from './+backup-format.ts'
import { type RecipeIndex } from './restore-recipes.server.ts'
import {
	type RecordFailure,
	refusedWriteCode,
} from './restore-results.server.ts'

type ImportMenu = z.infer<typeof ImportMenuSchema>
type ImportMenuItem = z.infer<typeof ImportMenuItemSchema>

/**
 * Restores Menus after the Recipe pass. References reconnect by export-local
 * reference key, falling back to normalized Recipe title only when a key is
 * absent (older or hand-edited data). On a normalized Menu-title collision
 * the existing target Menu wins and the imported Menu is skipped wholesale.
 * Shared copies retain their own source identity and disambiguate titles;
 * an already-restored shared copy wins without refreshing local edits.
 */
export async function importMenus(
	menus: ImportMenu[],
	recipeIndex: RecipeIndex,
	householdId: string,
	recordFailure: RecordFailure,
) {
	const stats = { created: 0, skipped: 0, errored: 0 }
	const sharedMenuIdsByTitleKey = new Map<string, string | null>()

	const existingMenus = await prisma.menu.findMany({
		where: { householdId },
		select: { id: true, titleKey: true, copiedFromMenuId: true },
	})
	const takenTitleKeys = new Set(existingMenus.map((menu) => menu.titleKey))

	const savedSources = new Map(
		existingMenus.flatMap((menu) =>
			menu.copiedFromMenuId ? [[menu.copiedFromMenuId, menu.id] as const] : [],
		),
	)
	for (const [index, menu] of menus.entries()) {
		if (menu.copiedFromMenuId) {
			const savedId = savedSources.get(menu.copiedFromMenuId)
			// Meals name their source Menu as it appeared in the export. Keep
			// that link even when this copy is renamed; a failed restore must
			// not fall back to a different Menu with the same title.
			sharedMenuIdsByTitleKey.set(menuTitleKey(menu.title), savedId ?? null)
			if (savedId) {
				stats.skipped++
				continue
			}
		}
		let title = menu.title
		let titleKey = menuTitleKey(title)
		if (takenTitleKeys.has(titleKey) && !menu.copiedFromMenuId) {
			stats.skipped++
			continue
		}
		// A shared copy's recovery identity is independent of its title.
		for (let n = 2; takenTitleKeys.has(titleKey); n++) {
			const suffix = ` (${n})`
			title = `${menu.title.slice(0, 100 - suffix.length)}${suffix}`
			titleKey = menuTitleKey(title)
		}
		takenTitleKeys.add(titleKey)

		// At most one unnamed section per Menu: the file's first unnamed
		// section wins, later unnamed ones merge into it. A Menu with no
		// unnamed section is valid; one with no sections at all still gets the
		// starting empty unnamed section so its cards have somewhere to live.
		const sections: Array<{
			name: string | null
			items: ImportMenuItem[]
		}> = []
		let unnamedIndex = -1
		for (const section of menu.sections ?? []) {
			const items = section.items ?? []
			if (section.name == null) {
				if (unnamedIndex === -1) {
					unnamedIndex = sections.length
					sections.push({ name: null, items: [...items] })
				} else {
					sections[unnamedIndex]!.items.push(...items)
				}
			} else {
				sections.push({ name: section.name, items: [...items] })
			}
		}
		if (sections.length === 0) sections.push({ name: null, items: [] })

		const resolveItem = (item: ImportMenuItem) => {
			if (item.kind === 'note') {
				return {
					kind: 'note' as const,
					note: item.text ?? '',
					shoppingLines: {
						create: (item.shoppingLines ?? []).map((line, order) => ({
							name: line.name,
							quantity: line.quantity || null,
							unit: line.unit || null,
							order,
						})),
					},
				}
			}
			let recipeId: string | null = null
			if (item.recipeRef != null) {
				recipeId = recipeIndex.refToIdMap.get(item.recipeRef) ?? null
			} else if (item.recipeTitle) {
				recipeId =
					recipeIndex.titleToIdMap.get(item.recipeTitle.toLowerCase()) ?? null
			}

			const recipeTitle =
				item.recipeTitle ??
				(recipeId != null
					? (recipeIndex.titleById.get(recipeId) ?? null)
					: null)
			return {
				kind: 'recipe' as const,
				recipeId,
				recipeTitle,
				// Stored multipliers stay positive with at most two decimals; a
				// crafted sub-0.005 value must not round down to zero.
				scaleMultiplier:
					item.scaleMultiplier != null
						? Math.max(0.01, Math.round(item.scaleMultiplier * 100) / 100)
						: 1,
				note: item.note || null,
			}
		}

		try {
			// One nested create per Menu, so it restores whole or not at all.
			const created = await prisma.menu.create({
				data: {
					title,
					titleKey,
					description: menu.description || null,
					defaultGuestCount: menu.defaultGuestCount ?? null,
					copiedFromMenuId: menu.copiedFromMenuId ?? null,
					householdId,
					sections: {
						create: sections.map((section, order) => ({
							name: section.name,
							order,
							items: {
								create: section.items.map((item, itemOrder) => ({
									order: itemOrder,
									...resolveItem(item),
								})),
							},
						})),
					},
				},
				select: { id: true },
			})
			if (menu.copiedFromMenuId) {
				savedSources.set(menu.copiedFromMenuId, created.id)
				sharedMenuIdsByTitleKey.set(menuTitleKey(menu.title), created.id)
			}
			stats.created++
		} catch (error) {
			const code = refusedWriteCode(error)
			if (!code) throw error
			recordFailure({ at: `menus[${index}]`, reason: 'write-refused', code })
			stats.errored++
		}
	}

	return { stats, sharedMenuIdsByTitleKey }
}
