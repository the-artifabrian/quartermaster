import { describe, expect, test } from 'vitest'
import {
	extractYieldFromTitle,
	joinBrokenUnitSteps,
	parseRecipeText,
	splitMultipleRecipes,
} from './bulk-recipe-parser.ts'

describe('splitMultipleRecipes', () => {
	test('returns single recipe when no separator', () => {
		const result = splitMultipleRecipes('My Recipe\nIngredients\n- flour')
		expect(result).toHaveLength(1)
		expect(result[0]).toBe('My Recipe\nIngredients\n- flour')
	})

	test('splits on --- separator', () => {
		const text = `Recipe One
Ingredients
- flour

---

Recipe Two
Ingredients
- sugar`
		const result = splitMultipleRecipes(text)
		expect(result).toHaveLength(2)
		expect(result[0]).toContain('Recipe One')
		expect(result[1]).toContain('Recipe Two')
	})

	test('handles --- with surrounding whitespace', () => {
		const text = `Recipe One
Ingredients
- flour
  ---
Recipe Two
Ingredients
- sugar`
		const result = splitMultipleRecipes(text)
		expect(result).toHaveLength(2)
	})

	test('filters out empty sections from multiple separators', () => {
		const text = `Recipe One
Ingredients
- flour

---

---

Recipe Two
Ingredients
- sugar`
		const result = splitMultipleRecipes(text)
		expect(result).toHaveLength(2)
	})
})

describe('parseRecipeText', () => {
	test('parses standard Apple Notes recipe format', () => {
		const text = `Chicken Stir Fry

Ingredients
- 2 cups chicken breast, diced
- 1 tbsp soy sauce
- 3 cloves garlic

Instructions
1. Heat oil in a pan.
2. Add chicken and cook until browned.
3. Add garlic and soy sauce.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Chicken Stir Fry')
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]).toEqual({
			name: 'chicken breast',
			amount: '2',
			unit: 'cups',
			notes: 'diced',
		})
		expect(result.instructions).toHaveLength(3)
		expect(result.instructions[0]!.content).toBe('Heat oil in a pan.')
		expect(result.warnings).toHaveLength(0)
	})

	test('handles "Ingredients:" with colon', () => {
		const text = `My Recipe

Ingredients:
- 1 cup flour

Instructions:
1. Mix it.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('My Recipe')
		expect(result.ingredients).toHaveLength(1)
		expect(result.instructions).toHaveLength(1)
	})

	test('handles INGREDIENTS heading (uppercase)', () => {
		const text = `My Recipe

INGREDIENTS
- 1 cup flour

INSTRUCTIONS
1. Mix it.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(1)
		expect(result.instructions).toHaveLength(1)
	})

	test('handles "Directions" heading', () => {
		const text = `Pasta

Ingredients
- 2 cups pasta

Directions
1. Boil water.
2. Cook pasta.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('handles "Steps" heading', () => {
		const text = `Salad

Ingredients
- lettuce

Steps
1. Wash lettuce.
2. Serve.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('handles "Method" heading', () => {
		const text = `Soup

Ingredients
- 1 can tomatoes

Method
Blend tomatoes.
Heat until warm.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('handles bullet styles: dash, bullet, asterisk', () => {
		const text = `Test Recipe

Ingredients
- 1 cup flour
• 2 eggs
* 1 tsp salt

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]!.name).toBe('flour')
		expect(result.ingredients[1]!.name).toBe('eggs')
		expect(result.ingredients[2]!.name).toBe('salt')
	})

	test('handles plain ingredients (no bullets)', () => {
		const text = `Simple Recipe

Ingredients
1 cup flour
2 eggs
salt

Instructions
1. Mix everything.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
	})

	test('strips numbered instruction prefixes', () => {
		const text = `Recipe

Ingredients
- flour

Instructions
1. First step
2) Second step
3 Third step`

		const result = parseRecipeText(text)
		expect(result.instructions[0]!.content).toBe('First step')
		expect(result.instructions[1]!.content).toBe('Second step')
		// "3 Third step" — the "3" is stripped as bullet prefix with "3 " pattern
		// but stripBullet only handles "3." and "3)", not "3 " — so it stays
		// Actually: /^\s*\d+[.)]\s+/ only matches "3." or "3)" not "3 "
		expect(result.instructions[2]!.content).toBe('3 Third step')
	})

	test('extracts description between title and first heading', () => {
		const text = `Grandma's Cookies
A family favorite passed down for generations.

Ingredients
- 2 cups flour

Instructions
1. Mix and bake.`

		const result = parseRecipeText(text)
		expect(result.title).toBe("Grandma's Cookies")
		expect(result.description).toBe(
			'A family favorite passed down for generations.',
		)
	})

	test('no description when title is directly above heading', () => {
		const text = `Quick Salad
Ingredients
- lettuce

Instructions
1. Serve.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Quick Salad')
		expect(result.description).toBeUndefined()
	})

	test('warns when no title found', () => {
		const text = `Ingredients
- 1 cup flour

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('')
		expect(result.warnings).toContain('No title found')
	})

	test('warns when no ingredients found', () => {
		const text = `My Recipe

Instructions
1. Do something.`

		const result = parseRecipeText(text)
		expect(result.warnings).toContain('No ingredients found')
	})

	test('warns when no instructions found', () => {
		const text = `My Recipe

Ingredients
- flour`

		const result = parseRecipeText(text)
		expect(result.warnings).toContain('No instructions found')
	})

	test('handles empty input', () => {
		const result = parseRecipeText('')
		expect(result.title).toBe('')
		expect(result.ingredients).toHaveLength(0)
		expect(result.instructions).toHaveLength(0)
		expect(result.warnings).toContain('No title found')
	})

	test('handles text with no headings', () => {
		const text = `Just Some Title
And some random text
Nothing structured here`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Just Some Title')
		expect(result.warnings).toContain('No ingredients found')
		expect(result.warnings).toContain('No instructions found')
	})

	test('strips markdown heading prefix from title', () => {
		const text = `# My Recipe

Ingredients
- 1 cup flour

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('My Recipe')
	})

	test('strips markdown bold from section headings', () => {
		const text = `My Recipe

**Ingredients**
- 1 cup flour

**Instructions**
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(1)
		expect(result.ingredients[0]!.name).toBe('flour')
		expect(result.instructions).toHaveLength(1)
		expect(result.warnings).toHaveLength(0)
	})

	test('strips markdown bold from ingredient text', () => {
		const text = `Recipe

Ingredients
- **200g** white sugar
- 1 cup **all-purpose flour**

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(2)
		expect(result.ingredients[0]!.amount).toBe('200')
		expect(result.ingredients[0]!.unit).toBe('g')
		expect(result.ingredients[0]!.name).toBe('white sugar')
		expect(result.ingredients[1]!.name).toBe('all-purpose flour')
	})

	test('strips markdown bold from sub-section headers', () => {
		const text = `Pizza

Ingredients
**Dough**
- 2 cups flour
**Sauce**
- 1 can tomatoes

Instructions
1. Make pizza.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(4)
		expect(result.ingredients[0]).toEqual({ name: 'Dough', isHeading: true })
		expect(result.ingredients[1]!.name).toBe('flour')
		expect(result.ingredients[1]!.notes).toBe('for Dough')
		expect(result.ingredients[2]).toEqual({ name: 'Sauce', isHeading: true })
		expect(result.ingredients[3]!.name).toBe('tomatoes')
		expect(result.ingredients[3]!.notes).toBe('for Sauce')
	})

	test('strips bold-italic markers from sub-section headers', () => {
		const text = `Eclair Cake

Ingredients
**_Choux Pastry_**
- 1 cup water
**_Ganache_**
- 1 cup cream

Instructions
1. Bake.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(4)
		expect(result.ingredients[0]).toEqual({
			name: 'Choux Pastry',
			isHeading: true,
		})
		expect(result.ingredients[1]!.name).toBe('water')
		expect(result.ingredients[1]!.notes).toBe('for Choux Pastry')
		expect(result.ingredients[2]).toEqual({ name: 'Ganache', isHeading: true })
		expect(result.ingredients[3]!.name).toBe('cream')
		expect(result.ingredients[3]!.notes).toBe('for Ganache')
	})

	test('strips Apple Notes link syntax', () => {
		const text = `Banana Bread

Ingredients
- 1 tsp ++[vanilla extract](https://www.amazon.com/some-product)++
- 1 cup ++[chocolate chips](https://www.amazon.com/another)++ plus extra

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients[0]!.name).toBe('vanilla extract')
		expect(result.ingredients[1]!.name).toContain('chocolate chips')
	})

	test('strips escaped markdown characters', () => {
		const text = `Recipe

Ingredients
- 1 cup flour\\*
- 2 eggs

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients[0]!.name).toBe('flour*')
	})

	test('preserves single * as bullet marker', () => {
		const text = `Recipe

Ingredients
* 1 cup flour
* 2 eggs

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(2)
		expect(result.ingredients[0]!.name).toBe('flour')
	})

	test('joins hard-wrapped continuation lines in instructions', () => {
		const text = `Recipe

Ingredients
- 1 cup flour

Instructions
- [ ] Cook 4-5 minutes until liquid is released and vegetable are starting to
      take on color.
- [ ] Meanwhile spread meat out on sheet tray and roast at 450 degrees until
      well browned and cooked through, this works under broiler well also, more
      caramelization there.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
		expect(result.instructions[0]!.content).toContain(
			'starting to take on color',
		)
		expect(result.instructions[1]!.content).toContain('caramelization there')
	})

	test('joins hard-wrapped continuation lines in ingredients', () => {
		const text = `Recipe

Ingredients
- [ ] 1 packet/7g powdered gelatin mixed with
      20-30mL water
- [ ] 2 cups flour

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(2)
		expect(result.ingredients[0]!.name).toContain('gelatin')
	})

	test('does not join bullet lines that happen to be indented', () => {
		const text = `Recipe

Ingredients
  - 1 cup flour
  - 2 eggs

Instructions
  1. Mix.
  2. Bake.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(2)
		expect(result.instructions).toHaveLength(2)
	})

	test('normalizes smart quotes', () => {
		const text = `Grandma\u2019s Cookies

Ingredients
- 1 cup flour

Instructions
1. Mix the \u201Cdough\u201D.`

		const result = parseRecipeText(text)
		expect(result.title).toBe("Grandma's Cookies")
		expect(result.instructions[0]!.content).toBe('Mix the "dough".')
	})

	test('normalizes non-breaking spaces', () => {
		const text = `My\u00A0Recipe

Ingredients
- 1\u00A0cup flour

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('My Recipe')
		expect(result.ingredients[0]!.unit).toBe('cup')
	})

	test('handles "Preparation" heading', () => {
		const text = `Cake

Ingredients
- flour

Preparation
1. Preheat oven.
2. Mix batter.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('strips checkbox markers from ingredients', () => {
		const text = `Checkbox Recipe

Ingredients
- [ ] 1 cup flour
- [x] 2 eggs
- [ ] salt

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]!.name).toBe('flour')
		expect(result.ingredients[0]!.amount).toBe('1')
		expect(result.ingredients[0]!.unit).toBe('cup')
		expect(result.ingredients[1]!.name).toBe('eggs')
		expect(result.ingredients[2]!.name).toBe('salt')
	})

	test('strips checkbox markers from instructions', () => {
		const text = `Recipe

Ingredients
- [ ] flour

Instructions
- [ ] Preheat oven to 350F.
- [x] Mix the batter.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
		expect(result.instructions[0]!.content).toBe('Preheat oven to 350F.')
		expect(result.instructions[1]!.content).toBe('Mix the batter.')
	})

	test('detects sub-section headers in bulleted ingredients', () => {
		const text = `Short Ribs

Ingredients
Gremolata Topping
- 1 cup parsley
- 3 cloves garlic
Polenta
- 2 cups cornmeal
- 4 cups water

Instructions
1. Make gremolata.
2. Cook polenta.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(6)
		expect(result.ingredients[0]).toEqual({
			name: 'Gremolata Topping',
			isHeading: true,
		})
		expect(result.ingredients[1]).toEqual({
			name: 'parsley',
			amount: '1',
			unit: 'cup',
			notes: 'for Gremolata Topping',
		})
		expect(result.ingredients[2]).toEqual({
			name: 'garlic',
			amount: '3',
			unit: 'cloves',
			notes: 'for Gremolata Topping',
		})
		expect(result.ingredients[3]).toEqual({ name: 'Polenta', isHeading: true })
		expect(result.ingredients[4]).toEqual({
			name: 'cornmeal',
			amount: '2',
			unit: 'cups',
			notes: 'for Polenta',
		})
		expect(result.ingredients[5]).toEqual({
			name: 'water',
			amount: '4',
			unit: 'cups',
			notes: 'for Polenta',
		})
	})

	test('keeps notes separate from heading ingredients', () => {
		const text = `Fancy Dish

Ingredients
Sauce
- 2 cups tomatoes, diced
- 1 tbsp olive oil

Instructions
1. Cook.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]).toEqual({ name: 'Sauce', isHeading: true })
		expect(result.ingredients[1]).toEqual({
			name: 'tomatoes',
			amount: '2',
			unit: 'cups',
			notes: 'diced, for Sauce',
		})
		expect(result.ingredients[2]).toEqual({
			name: 'olive oil',
			amount: '1',
			unit: 'tbsp',
			notes: 'for Sauce',
		})
	})

	test('strips trailing colon from sub-section headers', () => {
		const text = `Recipe

Ingredients
Filling:
- 1 cup ricotta
Base:
- 2 cups flour

Instructions
1. Assemble.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(4)
		expect(result.ingredients[0]).toEqual({ name: 'Filling', isHeading: true })
		expect(result.ingredients[1]!.name).toBe('ricotta')
		expect(result.ingredients[1]!.notes).toBe('for Filling')
		expect(result.ingredients[2]).toEqual({ name: 'Base', isHeading: true })
		expect(result.ingredients[3]!.name).toBe('flour')
		expect(result.ingredients[3]!.notes).toBe('for Base')
	})

	test('no sub-headers detected when section has no bullets', () => {
		const text = `Plain Recipe

Ingredients
1 cup flour
2 eggs
salt

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]!.notes).toBeUndefined()
		expect(result.ingredients[1]!.notes).toBeUndefined()
		expect(result.ingredients[2]!.notes).toBeUndefined()
	})

	test('splits inline bullet-separated ingredients on one line', () => {
		const text = `Raising Canes Chicken Tenders

Ingredients
For the Chicken
• 2 lbs chicken breast, cut into strips • Oil for frying
Dry Batter
• 2 cups all-purpose flour • 3 tbsp cornstarch • 1½ tsp smoked paprika • 2 tsp garlic powder • 2 tsp black pepper • 1 tsp salt
Wet Batter
• 2 cups buttermilk • 2 tsp garlic powder • 2 tsp black pepper • 1 tsp smoked paprika • 1 tsp salt
Cane's Sauce
• 1 cup mayonnaise • 4 tbsp ketchup • 2 tbsp Worcestershire sauce • 1 tbsp garlic powder • 2 tsp black pepper • 1 tsp smoked paprika

Instructions
1. In a bowl whisk together the buttermilk and spices.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Raising Canes Chicken Tenders')
		// 4 sub-headers + 17 ingredients
		const headings = result.ingredients.filter((i) => i.isHeading)
		const items = result.ingredients.filter((i) => !i.isHeading)
		expect(headings).toHaveLength(4)
		expect(items.length).toBeGreaterThanOrEqual(17)
		// Spot-check: first group should have 2 items with heading context.
		// "For the Chicken" is cleaned to "Chicken" (same as the LLM path).
		expect(headings[0]!.name).toBe('Chicken')
		expect(items[0]!.name).toBe('chicken breast')
		expect(items[0]!.amount).toBe('2')
		expect(items[0]!.unit).toBe('lbs')
		expect(items[0]!.notes).toContain('for Chicken')
		// Oil for frying should be its own item
		expect(items[1]!.name.toLowerCase()).toContain('oil')
		// Ingredients under different headings get their own context
		expect(items[2]!.notes).toContain('for Dry Batter')
	})

	test('full complex recipe with sub-headers and checkboxes', () => {
		const text = `Braised Short Ribs with Polenta

A hearty winter dish.

Ingredients
Braised Short Ribs
- [ ] 4 lbs bone-in short ribs
- [ ] 2 cups red wine
- [ ] 1 can tomatoes, crushed
Gremolata Topping
- [ ] 1 cup parsley, chopped
- [ ] 3 cloves garlic, minced
Polenta
- [ ] 2 cups cornmeal
- [ ] 4 cups water

Instructions
Braising (Day Before)
1. Season short ribs with salt.
2. Sear in hot pan until browned.
3. Add wine and tomatoes, braise for 3 hours.
Day Of
1. Make gremolata by mixing parsley and garlic.
2. Cook polenta with water.
3. Serve ribs over polenta, top with gremolata.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Braised Short Ribs with Polenta')
		expect(result.description).toBe('A hearty winter dish.')
		expect(result.ingredients).toHaveLength(10) // 3 headings + 7 ingredients
		expect(result.ingredients[0]).toEqual({
			name: 'Braised Short Ribs',
			isHeading: true,
		})
		expect(result.ingredients[1]!.name).toBe('bone-in short ribs')
		expect(result.ingredients[1]!.notes).toBe('for Braised Short Ribs')
		expect(result.ingredients[2]!.name).toBe('red wine')
		expect(result.ingredients[2]!.notes).toBe('for Braised Short Ribs')
		expect(result.ingredients[3]!.notes).toBe('crushed, for Braised Short Ribs')
		expect(result.ingredients[4]).toEqual({
			name: 'Gremolata Topping',
			isHeading: true,
		})
		expect(result.ingredients[5]!.notes).toBe('chopped, for Gremolata Topping')
		expect(result.ingredients[6]!.notes).toBe('minced, for Gremolata Topping')
		expect(result.ingredients[7]).toEqual({ name: 'Polenta', isHeading: true })
		expect(result.ingredients[8]!.name).toBe('cornmeal')
		expect(result.ingredients[8]!.notes).toBe('for Polenta')
		expect(result.ingredients[9]!.name).toBe('water')
		expect(result.ingredients[9]!.notes).toBe('for Polenta')
		expect(result.instructions).toHaveLength(8)
		// Sub-headers in instructions become their own steps
		expect(result.instructions[0]!.content).toBe('Braising (Day Before)')
		expect(result.instructions[4]!.content).toBe('Day Of')
		expect(result.warnings).toHaveLength(0)
	})
})

describe('extractYieldFromTitle', () => {
	test('strips parenthesized trailing serves', () => {
		expect(extractYieldFromTitle('Vermicelli Noodle Bowl (Serves 2)')).toEqual({
			title: 'Vermicelli Noodle Bowl',
			yieldAmount: 2,
			yieldLabel: 'servings',
		})
	})

	test('keeps range yields unknown rather than choosing a bound', () => {
		expect(extractYieldFromTitle('Pho (serves 4-6)')).toEqual({
			title: 'Pho (serves 4-6)',
			yieldAmount: null,
			yieldLabel: null,
		})

		const result = parseRecipeText(`Soup

Serves 4-6

Ingredients
- 2 cups broth

Instructions
1. Simmer.`)
		expect(result).toEqual(
			expect.objectContaining({
				yieldAmount: undefined,
				yieldLabel: undefined,
			}),
		)
	})

	test('strips dash/comma trailing serves', () => {
		expect(extractYieldFromTitle('Weeknight Curry — serves 4')).toEqual({
			title: 'Weeknight Curry',
			yieldAmount: 4,
			yieldLabel: 'servings',
		})
		expect(extractYieldFromTitle('Big Salad, serves 2')).toEqual({
			title: 'Big Salad',
			yieldAmount: 2,
			yieldLabel: 'servings',
		})
	})

	test('leaves titles without serves untouched', () => {
		expect(extractYieldFromTitle('Beef Bolognese')).toEqual({
			title: 'Beef Bolognese',
			yieldAmount: null,
			yieldLabel: null,
		})
		expect(extractYieldFromTitle('Buns for 4th of July')).toEqual({
			title: 'Buns for 4th of July',
			yieldAmount: null,
			yieldLabel: null,
		})
	})

	test('never strips the whole title', () => {
		expect(extractYieldFromTitle('(Serves 2)')).toEqual({
			title: '(Serves 2)',
			yieldAmount: null,
			yieldLabel: null,
		})
	})
})

describe('joinBrokenUnitSteps', () => {
	test('joins a step split inside a temperature pair', () => {
		const result = joinBrokenUnitSteps([
			{ content: 'Preheat oven to 350' },
			{ content: 'F / 180 C. Bake until golden.' },
		])
		expect(result).toHaveLength(1)
		expect(result[0]!.content).toBe(
			'Preheat oven to 350 F / 180 C. Bake until golden.',
		)
	})

	test('joins splits before degree and time words', () => {
		const result = joinBrokenUnitSteps([
			{ content: 'Roast at 425' },
			{ content: 'degrees for 20' },
			{ content: 'minutes, turning once.' },
		])
		expect(result).toHaveLength(1)
		expect(result[0]!.content).toBe(
			'Roast at 425 degrees for 20 minutes, turning once.',
		)
	})

	test('leaves complete steps alone', () => {
		const steps = [
			{ content: 'Preheat oven to 350F.' },
			{ content: 'Flour the pan.' },
			{ content: 'Bake for 30 minutes.' },
		]
		expect(joinBrokenUnitSteps(steps)).toEqual(steps)
	})

	test('does not join when the number ends a sentence', () => {
		const steps = [
			{ content: 'Reduce the sauce to about 350.' },
			{ content: 'Finish with butter.' },
		]
		expect(joinBrokenUnitSteps(steps)).toEqual(steps)
	})

	test('does not join when the next step starts with a regular word', () => {
		const steps = [
			{ content: 'Divide the dough into 8' },
			{ content: 'Shape each piece into a ball.' },
		]
		expect(joinBrokenUnitSteps(steps)).toEqual(steps)
	})
})

describe('parseRecipeText servings and headings', () => {
	test('captures explicit Serves and Makes text as paired typed yield', () => {
		const base = (yieldLine: string) => `Test recipe
${yieldLine}

Ingredients
- 1 onion

Instructions
1. Cook.`

		expect(parseRecipeText(base('Serves 6'))).toEqual(
			expect.objectContaining({ yieldAmount: 6, yieldLabel: 'servings' }),
		)
		expect(parseRecipeText(base('Makes 2 loaves'))).toEqual(
			expect.objectContaining({ yieldAmount: 2, yieldLabel: 'loaves' }),
		)
	})

	test('pulls "(Serves 2)" out of the title', () => {
		const text = `Vermicelli Noodle Bowl (Serves 2)

Ingredients
- 200 g vermicelli noodles

Instructions
1. Cook the noodles.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Vermicelli Noodle Bowl')
		expect(result).toEqual(
			expect.objectContaining({ yieldAmount: 2, yieldLabel: 'servings' }),
		)
	})

	test('captures a standalone serves line and keeps it out of the description', () => {
		const text = `Family Lasagna

Serves 8
A Sunday favorite.

Ingredients
- 1 box lasagna noodles

Instructions
1. Assemble and bake.`

		const result = parseRecipeText(text)
		expect(result).toEqual(
			expect.objectContaining({ yieldAmount: 8, yieldLabel: 'servings' }),
		)
		expect(result.description).toBe('A Sunday favorite.')
	})

	test('captures "Servings: N" and "Yield: N servings" forms', () => {
		const base = (line: string) => `Soup

${line}

Ingredients
- 2 cups broth

Instructions
1. Simmer.`

		expect(parseRecipeText(base('Servings: 6'))).toEqual(
			expect.objectContaining({ yieldAmount: 6, yieldLabel: 'servings' }),
		)
		expect(parseRecipeText(base('Yield: 4 servings'))).toEqual(
			expect.objectContaining({ yieldAmount: 4, yieldLabel: 'servings' }),
		)
		expect(parseRecipeText(base('Makes 12 cookies'))).toEqual(
			expect.objectContaining({ yieldAmount: 12, yieldLabel: 'cookies' }),
		)
	})

	test('title serves wins over a later body line', () => {
		const text = `Stew (Serves 2)

Serves 6

Ingredients
- 1 lb beef

Instructions
1. Braise.`

		expect(parseRecipeText(text)).toEqual(
			expect.objectContaining({ yieldAmount: 2, yieldLabel: 'servings' }),
		)
	})

	test('serves line inside the ingredient list is metadata, not an ingredient', () => {
		const text = `Pancakes

Ingredients
Serves 4
- 2 cups flour

Instructions
1. Fry.`

		const result = parseRecipeText(text)
		expect(result).toEqual(
			expect.objectContaining({ yieldAmount: 4, yieldLabel: 'servings' }),
		)
		expect(result.ingredients).toHaveLength(1)
		expect(result.ingredients[0]!.name).toBe('flour')
	})

	test('detects "For the …" headings on bulleted lines', () => {
		const text = `Galette

Ingredients
- For the crust:
- 2 cups flour
- For the filling:
- 3 apples

Instructions
1. Bake.`

		const result = parseRecipeText(text)
		expect(result.ingredients[0]).toEqual({ name: 'Crust', isHeading: true })
		expect(result.ingredients[1]!.name).toBe('flour')
		expect(result.ingredients[2]).toEqual({ name: 'Filling', isHeading: true })
		expect(result.ingredients[3]!.name).toBe('apples')
	})

	test('detects all-caps headings in non-bulleted sections', () => {
		const text = `Tart

Ingredients
PIE DOUGH
2 cups flour
FILLING
3 pears

Instructions
1. Bake.`

		const result = parseRecipeText(text)
		expect(result.ingredients[0]).toEqual({
			name: 'PIE DOUGH',
			isHeading: true,
		})
		expect(result.ingredients[1]!.name).toBe('flour')
		expect(result.ingredients[2]).toEqual({ name: 'FILLING', isHeading: true })
		expect(result.ingredients[3]!.name).toBe('pears')
	})

	test('joins instruction lines split mid-measurement and warns', () => {
		const text = `Roast Chicken

Ingredients
- 1 whole chicken

Instructions
1. Preheat oven to 425
2. F / 220 C.
3. Roast for 1 hour.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
		expect(result.instructions[0]!.content).toBe(
			'Preheat oven to 425 F / 220 C.',
		)
		expect(result.warnings).toContain(
			'Joined steps that were split mid-measurement',
		)
	})

	test('all-caps house style: caps ingredients stay ingredients', () => {
		const text = `Grandma's Stew

Ingredients
- BEEF CHUCK
- SALT
- PEPPER
- ONIONS
- 2 CUPS BEEF STOCK

Instructions
1. BROWN THE BEEF.`

		const result = parseRecipeText(text)
		const headings = result.ingredients.filter((i) => i.isHeading)
		expect(headings).toHaveLength(0)
		expect(result.ingredients.map((i) => i.name)).toContain('SALT')
		expect(result.ingredients.map((i) => i.name)).toContain('BEEF CHUCK')
	})

	test('all-caps house style: explicit heading signals still work', () => {
		const text = `Noodle Bowl

Ingredients
- FOR THE SAUCE
- SOY SAUCE
- SESAME OIL
- RICE VINEGAR
- HONEY

Instructions
1. WHISK EVERYTHING.`

		const result = parseRecipeText(text)
		expect(result.ingredients[0]).toEqual({ name: 'SAUCE', isHeading: true })
		expect(result.ingredients.slice(1).every((i) => !i.isHeading)).toBe(true)
	})

	test('mixed-case recipes keep all-caps heading detection', () => {
		const text = `Tart

Ingredients
- PIE DOUGH
- 2 cups flour
- 1 stick butter
- FILLING
- 3 pears
- 2 tbsp sugar

Instructions
1. Bake.`

		const result = parseRecipeText(text)
		expect(result.ingredients[0]).toEqual({
			name: 'PIE DOUGH',
			isHeading: true,
		})
		expect(result.ingredients[3]).toEqual({ name: 'FILLING', isHeading: true })
	})
})

test('repeated ingredient and instruction sections retain all dishes in text and bulk parsing', () => {
	const result = parseRecipeText(
		'Supper\nIngredients\n- 2 cans chickpeas\nInstructions\nWarm the chickpeas.\nIngredients\n1 lemon\nInstructions\nSqueeze the lemon.',
	)
	expect(result.ingredients.map((i) => i.name)).toEqual(['chickpeas', 'lemon'])
	expect(result.instructions.map((i) => i.content)).toEqual([
		'Warm the chickpeas.',
		'Squeeze the lemon.',
	])
})
