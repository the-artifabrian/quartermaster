/**
 * Shared recipe placeholder utilities.
 *
 * Generates deterministic warm-toned monogram styles for recipes without
 * images, based on a hash of the recipe title. Same-hue gradients keep the
 * tiles quiet but give them enough presence to carry an image slot.
 */

const PLACEHOLDER_THEMES = [
	{
		bg: 'bg-gradient-to-br from-amber-100 to-amber-200/70 dark:from-amber-950/40 dark:to-amber-900/25',
		letter: 'text-amber-700/45 dark:text-amber-400/35',
	},
	{
		bg: 'bg-gradient-to-br from-emerald-100/90 to-emerald-200/60 dark:from-emerald-950/35 dark:to-emerald-900/20',
		letter: 'text-emerald-800/40 dark:text-emerald-400/30',
	},
	{
		bg: 'bg-gradient-to-br from-rose-100 to-rose-200/60 dark:from-rose-950/35 dark:to-rose-900/20',
		letter: 'text-rose-800/40 dark:text-rose-400/30',
	},
	{
		bg: 'bg-gradient-to-br from-stone-200/80 to-stone-300/50 dark:from-stone-800/50 dark:to-stone-700/30',
		letter: 'text-stone-600/45 dark:text-stone-400/35',
	},
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
	const theme = PLACEHOLDER_THEMES[hash % PLACEHOLDER_THEMES.length]!

	return {
		bgClass: theme.bg,
		letterColorClass: theme.letter,
		letter: title.charAt(0).toUpperCase(),
	}
}
