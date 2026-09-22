import { describe, expect, test } from 'vitest'
import {
	normalizeIngredientName,
	getCanonicalIngredientName,
	isOptionalIngredient,
	isStapleIngredient,
} from './recipe-matching.server.ts'

describe('normalizeIngredientName', () => {
	test('lowercases and trims', () => {
		expect(normalizeIngredientName('  Chicken  ')).toBe('chicken')
	})

	test('removes parenthetical notes', () => {
		expect(normalizeIngredientName('flour (for tangzhong)')).toBe('flour')
	})

	test('removes comma-separated preparation instructions', () => {
		expect(normalizeIngredientName('scallions, finely diced')).toBe('scallion')
	})

	test('handles "or" alternatives — takes first option', () => {
		// "plain" is not a modifier, so "plain flour" stays as-is
		expect(normalizeIngredientName('plain flour or all purpose flour')).toBe(
			'plain flour',
		)
		expect(normalizeIngredientName('mirin or sake')).toBe('mirin')
	})

	test('skips "or" split when first part is only modifiers/numbers', () => {
		// "large" is a modifier — the "or" separates quantity alternatives, not ingredients
		expect(normalizeIngredientName('large or 2 medium yellow onions')).toBe(
			'yellow onion',
		)
		expect(normalizeIngredientName('large white or red onion')).toBe(
			'red onion',
		)
	})

	test('handles slash alternatives — takes first option', () => {
		expect(normalizeIngredientName('mirin/sake/white wine')).toBe('mirin')
	})

	test('strips freshness/state modifiers', () => {
		expect(normalizeIngredientName('fresh basil')).toBe('basil')
		expect(normalizeIngredientName('dried oregano')).toBe('oregano')
		expect(normalizeIngredientName('frozen peas')).toBe('pea')
	})

	test('strips preparation modifiers', () => {
		expect(normalizeIngredientName('chopped onion')).toBe('onion')
		expect(normalizeIngredientName('minced garlic')).toBe('garlic')
		expect(normalizeIngredientName('grated parmesan')).toBe('parmesan')
	})

	test('strips size modifiers', () => {
		expect(normalizeIngredientName('large eggs')).toBe('egg')
		expect(normalizeIngredientName('medium onion')).toBe('onion')
	})

	test('strips color modifiers for non-protected compounds', () => {
		expect(normalizeIngredientName('yellow bell pepper')).toBe('bell pepper')
		expect(normalizeIngredientName('red bell peppers')).toBe('bell pepper')
	})

	test('protects compound ingredients from modifier stripping', () => {
		expect(normalizeIngredientName('green onion')).toBe('green onion')
		expect(normalizeIngredientName('green onions')).toBe('green onion')
		expect(normalizeIngredientName('red pepper')).toBe('red pepper')
		expect(normalizeIngredientName('red onion')).toBe('red onion')
		expect(normalizeIngredientName('brown sugar')).toBe('brown sugar')
		expect(normalizeIngredientName('white wine')).toBe('white wine')
		expect(normalizeIngredientName('dark chocolate')).toBe('dark chocolate')
		expect(normalizeIngredientName('black bean')).toBe('black bean')
		expect(normalizeIngredientName('black beans')).toBe('black bean')
	})

	test('strips non-identity modifiers but keeps protected compound parts', () => {
		// "large green onions" — "large" is stripped, "green" is protected via "green onion"
		expect(normalizeIngredientName('large green onions')).toBe('green onion')
	})

	test('strips sugar/grain type modifiers', () => {
		expect(normalizeIngredientName('granulated sugar')).toBe('sugar')
		expect(normalizeIngredientName('powdered sugar')).toBe('sugar')
		expect(normalizeIngredientName('confectioners sugar')).toBe('sugar')
	})

	test('handles irregular plurals', () => {
		expect(normalizeIngredientName('tomatoes')).toBe('tomato')
		expect(normalizeIngredientName('potatoes')).toBe('potato')
	})

	test('handles -ies plurals', () => {
		expect(normalizeIngredientName('berries')).toBe('berry')
	})

	test('handles -es plurals for sibilant endings', () => {
		expect(normalizeIngredientName('peaches')).toBe('peach')
	})

	test('handles simple -s plurals', () => {
		expect(normalizeIngredientName('carrots')).toBe('carrot')
		expect(normalizeIngredientName('onions')).toBe('onion')
	})

	test('does not strip short words (<=3 chars)', () => {
		expect(normalizeIngredientName('egg')).toBe('egg')
	})

	test('combines multiple normalizations', () => {
		expect(normalizeIngredientName('Fresh Garlic, minced')).toBe('garlic')
		expect(normalizeIngredientName('large red bell peppers (roasted)')).toBe(
			'bell pepper',
		)
	})

	test('strips leading "of " from ingredient names', () => {
		expect(normalizeIngredientName('of garlic')).toBe('garlic')
		expect(normalizeIngredientName('of celery')).toBe('celery')
	})

	test('strips meat descriptors', () => {
		expect(normalizeIngredientName('boneless chicken thighs')).toBe(
			'chicken thigh',
		)
		expect(normalizeIngredientName('skinless chicken breast')).toBe(
			'chicken breast',
		)
		expect(normalizeIngredientName('bone-in pork chops')).toBe('pork chop')
	})

	test('strips processing modifiers', () => {
		expect(normalizeIngredientName('smoked paprika')).toBe('paprika')
		expect(normalizeIngredientName('roasted peanuts')).toBe('peanut')
		expect(normalizeIngredientName('toasted sesame seeds')).toBe('sesame seed')
	})

	test('protects ground proteins from modifier stripping', () => {
		expect(normalizeIngredientName('ground chicken')).toBe('ground chicken')
		expect(normalizeIngredientName('ground beef')).toBe('ground beef')
		expect(normalizeIngredientName('ground turkey')).toBe('ground turkey')
	})

	test('strips ground from spices (not protected)', () => {
		expect(normalizeIngredientName('ground cumin')).toBe('cumin')
		expect(normalizeIngredientName('ground nutmeg')).toBe('nutmeg')
		expect(normalizeIngredientName('ground coriander')).toBe('coriander')
	})

	test('strips "cracked" and "freshly" modifiers', () => {
		expect(normalizeIngredientName('cracked black pepper')).toBe('black pepper')
		expect(normalizeIngredientName('freshly cracked black pepper')).toBe(
			'black pepper',
		)
	})

	test('strips trailing "to taste"', () => {
		expect(normalizeIngredientName('salt to taste')).toBe('salt')
		expect(normalizeIngredientName('ginger to taste')).toBe('ginger')
		expect(normalizeIngredientName('chili flakes to taste')).toBe('chili flake')
	})
})

describe('getCanonicalIngredientName', () => {
	test('returns normalized name when no synonyms exist', () => {
		expect(getCanonicalIngredientName('carrots')).toBe('carrot')
	})

	test('bidirectional: cilantro and coriander map to the same canonical name', () => {
		const fromCilantro = getCanonicalIngredientName('cilantro')
		const fromCoriander = getCanonicalIngredientName('coriander')
		expect(fromCilantro).toBe(fromCoriander)
	})

	test('scallion and green onion share canonical name (compound protection fix)', () => {
		// "green onion" → protected compound, "green" NOT stripped → "green onion"
		// "scallion" → synonyms: green onion, spring onion → canonical: "green onion"
		const fromScallion = getCanonicalIngredientName('scallion')
		const fromGreenOnion = getCanonicalIngredientName('green onion')
		expect(fromScallion).toBe(fromGreenOnion)
	})

	test('bidirectional: stock and broth map to the same canonical name', () => {
		const fromStock = getCanonicalIngredientName('stock')
		const fromBroth = getCanonicalIngredientName('broth')
		expect(fromStock).toBe(fromBroth)
	})

	test('beef stock and beef broth share canonical name', () => {
		expect(getCanonicalIngredientName('beef stock')).toBe(
			getCanonicalIngredientName('beef broth'),
		)
	})

	test('vegetable stock and vegetable broth share canonical name', () => {
		expect(getCanonicalIngredientName('vegetable stock')).toBe(
			getCanonicalIngredientName('vegetable broth'),
		)
	})

	test('canonical name is alphabetically first among equivalents', () => {
		// cilantro's synonyms: coriander, chinese parsley
		// equivalents: cilantro, coriander, chinese parsley → sorted: chinese parsley
		expect(getCanonicalIngredientName('cilantro')).toBe('chinese parsley')
	})

	test('handles modifier-stripped names that land on synonym keys', () => {
		// "powdered sugar" → modifier stripped → "sugar" → synonym: "icing sugar"
		expect(getCanonicalIngredientName('powdered sugar')).toBe(
			getCanonicalIngredientName('icing sugar'),
		)
	})

	test('"garlic cloves" and "garlic" share canonical name', () => {
		// "garlic cloves" → depluralized → "garlic clove" → synonym → "garlic"
		const fromCloves = getCanonicalIngredientName('garlic cloves')
		const fromGarlic = getCanonicalIngredientName('garlic')
		expect(fromCloves).toBe(fromGarlic)
	})

	test('"celery stalks" and "celery" share canonical name', () => {
		const fromStalks = getCanonicalIngredientName('celery stalks')
		const fromCelery = getCanonicalIngredientName('celery')
		expect(fromStalks).toBe(fromCelery)
	})
})

describe('isStapleIngredient', () => {
	test('recognizes common staples', () => {
		expect(isStapleIngredient({ name: 'salt' })).toBe(true)
		expect(isStapleIngredient({ name: 'water' })).toBe(true)
		expect(isStapleIngredient({ name: 'olive oil' })).toBe(true)
		expect(isStapleIngredient({ name: 'black pepper' })).toBe(true)
	})

	test('handles case and modifiers', () => {
		expect(isStapleIngredient({ name: 'Kosher Salt' })).toBe(true)
		expect(isStapleIngredient({ name: 'freshly ground black pepper' })).toBe(
			true,
		)
	})

	test('recognizes compound staples with "and"/"&"', () => {
		expect(isStapleIngredient({ name: 'salt and pepper' })).toBe(true)
		expect(isStapleIngredient({ name: 'salt and black pepper' })).toBe(true)
		expect(isStapleIngredient({ name: 'Salt & Pepper' })).toBe(true)
	})

	test('compound with non-staple part returns false', () => {
		expect(isStapleIngredient({ name: 'salt and garlic' })).toBe(false)
	})

	test('freshly cracked black pepper is a staple', () => {
		expect(
			isStapleIngredient({ name: 'Freshly cracked black pepper to taste' }),
		).toBe(true)
	})

	test('non-staples return false', () => {
		expect(isStapleIngredient({ name: 'chicken' })).toBe(false)
		expect(isStapleIngredient({ name: 'flour' })).toBe(false)
		expect(isStapleIngredient({ name: 'butter' })).toBe(false)
	})
})

describe('isOptionalIngredient', () => {
	test('recognizes "optional" in notes', () => {
		expect(isOptionalIngredient({ notes: 'optional' })).toBe(true)
		expect(isOptionalIngredient({ notes: 'Optional' })).toBe(true)
		expect(isOptionalIngredient({ notes: 'for garnish, optional' })).toBe(true)
		expect(isOptionalIngredient({ notes: '(optional)' })).toBe(true)
	})

	test('recognizes "(optional)" in name field', () => {
		expect(
			isOptionalIngredient({
				name: 'Pinch of gremolata (optional)',
				notes: null,
			}),
		).toBe(true)
	})

	test('returns false when notes do not contain optional', () => {
		expect(isOptionalIngredient({ notes: null })).toBe(false)
		expect(isOptionalIngredient({ notes: 'diced' })).toBe(false)
		expect(isOptionalIngredient({ notes: 'room temperature' })).toBe(false)
	})
})
