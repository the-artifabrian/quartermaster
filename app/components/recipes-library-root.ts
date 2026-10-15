/**
 * Where a re-tap on the Recipes tab lands. The tab holds two libraries,
 * Recipes and Menus, switched at the top of each list (LibrarySwitch). A
 * re-tap on a page below a list pops to the library the page was opened
 * from, as a native tab bar pops its stack to the root: a Menu's Recipe
 * returns to Menus, a planned Recipe opened from the Plan returns to Recipes.
 */
export type RecipesLibraryRoot = '/recipes' | '/recipes/menus'

export const DEFAULT_RECIPES_LIBRARY_ROOT: RecipesLibraryRoot = '/recipes'

export function isRecipesTabPath(pathname: string) {
	return pathname === '/recipes' || pathname.startsWith('/recipes/')
}

function isMenusPath(pathname: string) {
	return pathname === '/recipes/menus' || pathname.startsWith('/recipes/menus/')
}

/**
 * The library root after landing on `pathname`, given the root before it.
 *
 * - Either list names its own library.
 * - A Menu page belongs to Menus, however it was reached.
 * - A Recipe page keeps the library it was opened from. Entered from outside
 *   the tab (a Plan link, not the tab bar restoring the page), it belongs to
 *   Recipes.
 * - A page outside the tab leaves the root alone, so a tab switch keeps it.
 */
export function recipesLibraryRootAfter(
	root: RecipesLibraryRoot,
	{
		pathname,
		enteredFromOutside,
	}: { pathname: string; enteredFromOutside: boolean },
): RecipesLibraryRoot {
	if (!isRecipesTabPath(pathname)) return root
	if (isMenusPath(pathname)) return '/recipes/menus'
	if (pathname === '/recipes') return '/recipes'
	return enteredFromOutside ? '/recipes' : root
}
