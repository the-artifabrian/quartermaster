/**
 * Shared recipe placeholder utilities.
 *
 * Generates deterministic warm-toned placeholder styles for recipes
 * without images, based on a hash of the recipe title.
 */

const PLACEHOLDER_THEMES = [
	{ bg: 'bg-amber-50/80 dark:bg-amber-900/20', border: 'border-l-amber-400/50 dark:border-l-amber-500/40' },
	{ bg: 'bg-emerald-50/80 dark:bg-emerald-900/15', border: 'border-l-emerald-400/50 dark:border-l-emerald-500/40' },
	{ bg: 'bg-rose-50/80 dark:bg-rose-900/15', border: 'border-l-rose-400/50 dark:border-l-rose-500/40' },
	{ bg: 'bg-stone-100/80 dark:bg-stone-800/20', border: 'border-l-stone-400/50 dark:border-l-stone-400/40' },
	{ bg: 'bg-sky-50/80 dark:bg-sky-900/15', border: 'border-l-sky-400/50 dark:border-l-sky-500/40' },
	{ bg: 'bg-violet-50/80 dark:bg-violet-900/15', border: 'border-l-violet-400/50 dark:border-l-violet-500/40' },
] as const

const LETTER_COLORS = [
	'text-amber-400/50 dark:text-amber-500/30',
	'text-emerald-400/50 dark:text-emerald-500/30',
	'text-rose-400/50 dark:text-rose-500/30',
	'text-stone-400/50 dark:text-stone-400/30',
	'text-sky-400/50 dark:text-sky-500/30',
	'text-violet-400/50 dark:text-violet-500/30',
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
export function getRecipePlaceholder(title: string) {
	const hash = hashTitle(title)
	const index = hash % PLACEHOLDER_THEMES.length

	return {
		bgClass: PLACEHOLDER_THEMES[index]!.bg,
		borderClass: PLACEHOLDER_THEMES[index]!.border,
		letterColorClass: LETTER_COLORS[index]!,
		letter: title.charAt(0).toUpperCase(),
	}
}
