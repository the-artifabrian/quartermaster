/**
 * Shared recipe placeholder utilities.
 *
 * Generates deterministic warm-toned placeholder styles for recipes
 * without images, based on a hash of the recipe title.
 */

import { type IconName } from '@/icon-name'

const PLACEHOLDER_THEMES = [
	{ name: 'terracotta', hue: 25, bg: 'bg-orange-50 dark:bg-orange-950/30' },
	{ name: 'sage', hue: 140, bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
	{ name: 'golden', hue: 45, bg: 'bg-amber-50 dark:bg-amber-950/30' },
	{ name: 'dusty-rose', hue: 350, bg: 'bg-rose-50 dark:bg-rose-950/30' },
	{ name: 'slate-blue', hue: 220, bg: 'bg-sky-50 dark:bg-sky-950/30' },
	{ name: 'warm-plum', hue: 280, bg: 'bg-purple-50 dark:bg-purple-950/30' },
] as const

const ICON_COLORS = [
	'text-orange-300 dark:text-orange-800',
	'text-emerald-300 dark:text-emerald-800',
	'text-amber-300 dark:text-amber-800',
	'text-rose-300 dark:text-rose-800',
	'text-sky-300 dark:text-sky-800',
	'text-purple-300 dark:text-purple-800',
] as const

const LETTER_COLORS = [
	'text-orange-400/60 dark:text-orange-700/60',
	'text-emerald-400/60 dark:text-emerald-700/60',
	'text-amber-400/60 dark:text-amber-700/60',
	'text-rose-400/60 dark:text-rose-700/60',
	'text-sky-400/60 dark:text-sky-700/60',
	'text-purple-400/60 dark:text-purple-700/60',
] as const

function hashTitle(title: string): number {
	let hash = 0
	for (let i = 0; i < title.length; i++) {
		hash = (hash << 5) - hash + title.charCodeAt(i)
		hash = hash & hash
	}
	return Math.abs(hash)
}

/**
 * Returns placeholder styling info for a recipe without an image.
 * The result is deterministic based on the recipe title.
 */
export function getRecipePlaceholder(
	title: string,
	_tags?: Array<{ name: string; category: string }>,
) {
	const hash = hashTitle(title)
	const index = hash % PLACEHOLDER_THEMES.length
	const iconName: IconName = 'cookie'

	return {
		bgClass: PLACEHOLDER_THEMES[index]!.bg,
		iconColorClass: ICON_COLORS[index]!,
		letterColorClass: LETTER_COLORS[index]!,
		letter: title.charAt(0).toUpperCase(),
		iconName,
	}
}
