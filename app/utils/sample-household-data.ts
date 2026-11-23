import { type MealLabelSchema } from './meal-plan-validation.ts'
import { type RecipeMetadataDimension } from './recipe-metadata.ts'
import { type ShoppingHorizon } from './shopping-horizon.ts'

/**
 * What the sample Household holds, kept apart from the code that writes it
 * (sample-household.server.ts) so the content can grow without touching the
 * writes. Recipes are keyed by title: the Plan names them that way.
 */
export type SampleHouseholdContent = {
	recipes: SampleRecipe[]
	staples: string[]
	plan: SampleMeal[]
	shopping: {
		/** Typed rows. Their names are things no sample Recipe uses. */
		manual: SampleShoppingRow[]
		/** Ingredients already bought for a planned Meal. */
		checkedMealLines: string[]
	}
}

export type SampleRecipe = {
	title: string
	description: string
	activeTime: number
	totalTime: number
	yieldAmount: number
	yieldLabel: string
	classification: Partial<Record<RecipeMetadataDimension, string[]>>
	/** Lines as a cook types them, or a heading that groups the lines after it. */
	ingredients: Array<string | { heading: string }>
	steps: string[]
	notes?: string
}

export type SampleMeal = {
	/** Days after the Monday the week starts on: 0 is Monday, 6 is Sunday. */
	day: number
	label: (typeof MealLabelSchema)['options'][number]
} & ({ recipes: string[] } | { text: string })

export type SampleShoppingRow = {
	name: string
	quantity?: string
	unit?: string
	horizon: ShoppingHorizon
	checked?: boolean
}

export const SAMPLE_HOUSEHOLD: SampleHouseholdContent = {
	recipes: [
		{
			title: 'Lemon chicken traybake',
			description:
				'Chicken thighs roasted on a bed of potatoes with lemon and whole garlic cloves. Most of the hour is oven time.',
			activeTime: 15,
			totalTime: 60,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: { course: ['Main'], season: ['Year-round'] },
			ingredients: [
				'8 chicken thighs, skin on',
				'800 g small potatoes, halved',
				'2 lemons',
				'6 garlic cloves, unpeeled',
				'3 tbsp olive oil',
				'1 tsp dried oregano',
				'1 tsp salt',
				'black pepper',
			],
			steps: [
				'Heat the oven to 200°C.',
				'Put the potatoes and garlic in a large roasting tin. Toss them with half the oil, the salt and plenty of pepper.',
				'Sit the chicken on top, skin side up. Squeeze one lemon over it, cut the other into wedges and tuck them in between.',
				'Rub the rest of the oil and the oregano into the skin.',
				'Roast for 45 minutes, until the skin is crisp and the potatoes are golden. Squeeze the soft garlic out of its skins and stir it through.',
			],
		},
		{
			title: 'Chickpea and spinach curry',
			description:
				'A quick curry from the cupboard, with a bag of spinach stirred in at the end.',
			activeTime: 15,
			totalTime: 30,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Indian'],
				course: ['Main'],
				season: ['Year-round'],
			},
			ingredients: [
				'1 tbsp vegetable oil',
				'1 onion, finely chopped',
				'3 garlic cloves, grated',
				'1 tbsp ginger, grated',
				'2 tbsp curry paste',
				'400 g passata',
				'2 cans chickpeas, drained',
				'200 ml coconut milk',
				'150 g baby spinach',
				'1 tsp salt',
				'rice, to serve',
			],
			steps: [
				'Fry the onion in the oil over a medium heat for 8 minutes, until soft.',
				'Add the garlic, ginger and curry paste and cook for a minute more.',
				'Tip in the passata, chickpeas and coconut milk. Simmer for 10 minutes.',
				'Stir in the spinach a handful at a time until it wilts. Season with the salt and serve with rice.',
			],
			notes: 'Keeps for three days in the fridge and is better on the second.',
		},
		{
			title: 'Tomato and basil spaghetti',
			description:
				'Cherry tomatoes cooked down in garlicky oil until they burst. Ready in the time the pasta takes.',
			activeTime: 10,
			totalTime: 20,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Italian'],
				course: ['Main'],
				season: ['Summer'],
			},
			ingredients: [
				'400 g spaghetti',
				'4 tbsp olive oil',
				'3 garlic cloves, sliced',
				'500 g cherry tomatoes, halved',
				'1 pinch chilli flakes',
				'20 g basil',
				'40 g parmesan, grated',
			],
			steps: [
				'Cook the spaghetti in plenty of salted water.',
				'Meanwhile, warm the oil and garlic in a wide pan until the garlic just turns gold.',
				'Add the tomatoes and chilli and cook for 8 minutes, pressing a few with a spoon so they burst.',
				'Drain the pasta, keeping a cup of the water. Toss the pasta in the sauce with a splash of the water, then the basil.',
				'Serve with the parmesan.',
			],
		},
		{
			title: 'Greek salad',
			description: 'Tomato and cucumber salad with a slab of feta on top.',
			activeTime: 15,
			totalTime: 15,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Greek'],
				course: ['Side'],
				season: ['Summer'],
			},
			ingredients: [
				'4 tomatoes, cut into wedges',
				'1 cucumber, sliced',
				'1 red onion, thinly sliced',
				'1 green pepper, sliced',
				'100 g kalamata olives',
				'200 g feta',
				'3 tbsp olive oil',
				'1 tbsp red wine vinegar',
				'1 tsp dried oregano',
			],
			steps: [
				'Put the tomatoes, cucumber, onion, pepper and olives in a wide bowl.',
				'Whisk the oil and vinegar together and pour over.',
				'Lay the feta on top in one piece and scatter the oregano over it.',
			],
		},
		{
			title: 'Beef and broccoli stir-fry',
			description:
				'Thin strips of steak and broccoli in a glossy soy sauce. Have everything chopped before the pan goes on.',
			activeTime: 20,
			totalTime: 25,
			yieldAmount: 3,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Chinese'],
				course: ['Main'],
				season: ['Year-round'],
			},
			ingredients: [
				{ heading: 'Sauce' },
				'3 tbsp soy sauce',
				'1 tbsp oyster sauce',
				'1 tsp sugar',
				'1 tsp cornflour',
				{ heading: 'Stir-fry' },
				'400 g beef steak, thinly sliced',
				'1 head broccoli, cut into small florets',
				'2 tbsp vegetable oil',
				'2 garlic cloves, chopped',
				'1 tbsp ginger, grated',
				'4 spring onions, sliced',
				'rice, to serve',
			],
			steps: [
				'Mix the sauce ingredients with 4 tbsp water and set aside.',
				'Heat half the oil in a wok until it smokes. Fry the beef in two batches for a minute each, then lift it out.',
				'Add the rest of the oil and the broccoli with a splash of water. Cover and steam for 2 minutes.',
				'Add the garlic, ginger and spring onions and fry for 30 seconds.',
				'Put the beef back, pour in the sauce and toss until it thickens. Serve with rice.',
			],
		},
		{
			title: 'Black bean tacos',
			description:
				'Spiced black beans in warm tortillas, with avocado and feta on top.',
			activeTime: 20,
			totalTime: 20,
			yieldAmount: 8,
			yieldLabel: 'tacos',
			classification: {
				cuisine: ['Mexican'],
				course: ['Main'],
				season: ['Year-round'],
			},
			ingredients: [
				'2 tbsp vegetable oil',
				'1 red onion, chopped',
				'2 tsp ground cumin',
				'1 tsp smoked paprika',
				'2 cans black beans, drained',
				'1 lime',
				'8 small tortillas',
				'1 avocado',
				'100 g feta, crumbled',
				'4 tbsp soured cream',
				'1 bunch coriander',
			],
			steps: [
				'Fry the onion in the oil for 5 minutes. Add the cumin and paprika and cook for a minute.',
				'Add the beans and a splash of water. Mash about half of them and cook until thick. Squeeze in half the lime.',
				'Warm the tortillas in a dry pan.',
				'Fill each one with beans, sliced avocado, feta, soured cream and coriander. Serve the rest of the lime in wedges.',
			],
		},
		{
			title: 'Sausage and pepper traybake',
			description:
				'Sausages roasted with peppers and red onion until sticky. Good with bread or mash.',
			activeTime: 10,
			totalTime: 50,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: { course: ['Main'], season: ['Autumn', 'Winter'] },
			ingredients: [
				'8 pork sausages',
				'3 peppers, cut into strips',
				'2 red onions, cut into wedges',
				'2 tbsp olive oil',
				'1 tsp fennel seeds',
				'1 tbsp balsamic vinegar',
			],
			steps: [
				'Heat the oven to 200°C.',
				'Toss the peppers and onions with the oil and fennel seeds in a roasting tin. Lay the sausages on top.',
				'Roast for 35 minutes, turning the sausages halfway.',
				'Drizzle the vinegar over and roast for 5 minutes more.',
			],
		},
		{
			title: 'Mushroom omelette',
			description: 'A weekend breakfast for two, made one omelette at a time.',
			activeTime: 15,
			totalTime: 15,
			yieldAmount: 2,
			yieldLabel: 'servings',
			classification: { course: ['Breakfast'], season: ['Year-round'] },
			ingredients: [
				'6 eggs',
				'200 g mushrooms, sliced',
				'2 tbsp butter',
				'40 g cheddar, grated',
				'2 tbsp chives, chopped',
				'1 pinch salt',
			],
			steps: [
				'Fry the mushrooms in half the butter until golden, then tip them onto a plate.',
				'Beat the eggs with the salt.',
				'Melt half the remaining butter in the pan. Pour in half the eggs and stir gently until almost set.',
				'Scatter half the mushrooms, cheese and chives over one side, fold and slide onto a plate.',
				'Make the second omelette the same way with the rest.',
			],
		},
		{
			title: 'Red lentil soup',
			description:
				'A thick lentil soup with cumin and a squeeze of lemon. Freezes well.',
			activeTime: 15,
			totalTime: 40,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Turkish'],
				course: ['Main'],
				season: ['Winter'],
			},
			ingredients: [
				'2 tbsp olive oil',
				'1 onion, chopped',
				'2 carrots, chopped',
				'2 garlic cloves, chopped',
				'1 tsp ground cumin',
				'250 g red lentils, rinsed',
				'1.2 l vegetable stock',
				'1 lemon',
			],
			steps: [
				'Soften the onion and carrots in the oil for 10 minutes.',
				'Add the garlic and cumin and cook for a minute.',
				'Add the lentils and stock. Simmer for 20 minutes, until the lentils fall apart.',
				'Blend until smooth and squeeze in the lemon.',
			],
		},
		{
			title: 'Soy and ginger salmon',
			description:
				'Salmon baked under a sticky soy and ginger glaze, with green beans on the side.',
			activeTime: 10,
			totalTime: 25,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Japanese'],
				course: ['Main'],
				season: ['Year-round'],
			},
			ingredients: [
				'4 salmon fillets',
				'3 tbsp soy sauce',
				'1 tbsp honey',
				'1 tbsp ginger, grated',
				'1 tsp sesame oil',
				'2 spring onions, sliced',
				'300 g green beans',
				'rice, to serve',
			],
			steps: [
				'Heat the oven to 200°C.',
				'Mix the soy sauce, honey, ginger and sesame oil. Pour it over the salmon in a baking dish.',
				'Bake for 12 to 15 minutes, until the salmon flakes.',
				'Boil the green beans for 4 minutes while the salmon cooks.',
				'Scatter the spring onions over the salmon and serve with the beans and rice.',
			],
		},
		{
			title: 'Egg fried rice',
			description: 'What to do with yesterday’s rice.',
			activeTime: 15,
			totalTime: 15,
			yieldAmount: 2,
			yieldLabel: 'servings',
			classification: {
				cuisine: ['Chinese'],
				course: ['Main', 'Side'],
				season: ['Year-round'],
			},
			ingredients: [
				'500 g cooked rice, cold',
				'3 eggs, beaten',
				'150 g frozen peas',
				'4 spring onions, sliced',
				'2 tbsp vegetable oil',
				'2 tbsp soy sauce',
				'1 tsp sesame oil',
			],
			steps: [
				'Heat the oil in a wok until very hot. Add the peas and spring onions and fry for a minute.',
				'Add the rice and fry for 3 minutes, breaking up any clumps.',
				'Push the rice to one side, pour the eggs into the gap and scramble them, then stir through.',
				'Season with the soy sauce and sesame oil.',
			],
			notes:
				'Rice cooked the day before and kept in the fridge fries best. Fresh rice turns sticky.',
		},
		{
			title: 'Roast carrots with cumin',
			description: 'Sweet roast carrots on a spoonful of yoghurt.',
			activeTime: 10,
			totalTime: 40,
			yieldAmount: 4,
			yieldLabel: 'servings',
			classification: { course: ['Side'], season: ['Autumn', 'Winter'] },
			ingredients: [
				'600 g carrots, cut into batons',
				'2 tbsp olive oil',
				'1 tsp cumin seeds',
				'1 tbsp honey',
				'100 g Greek yoghurt',
			],
			steps: [
				'Heat the oven to 200°C.',
				'Toss the carrots with the oil and cumin seeds and roast for 25 minutes.',
				'Drizzle with the honey and roast for 5 minutes more.',
				'Spread the yoghurt on a plate and pile the carrots on top.',
			],
		},
		{
			title: 'Overnight oats',
			description: 'Made the night before, eaten cold.',
			activeTime: 5,
			totalTime: 480,
			yieldAmount: 1,
			yieldLabel: 'serving',
			classification: { course: ['Breakfast'], season: ['Year-round'] },
			ingredients: [
				'80 g rolled oats',
				'150 ml milk',
				'2 tbsp Greek yoghurt',
				'1 tsp honey',
				'50 g blueberries',
			],
			steps: [
				'Stir the oats, milk and yoghurt together in a jar.',
				'Cover and leave in the fridge overnight.',
				'Top with the honey and blueberries in the morning.',
			],
		},
		{
			title: 'Banana bread',
			description: 'For the bananas nobody wants to eat.',
			activeTime: 15,
			totalTime: 85,
			yieldAmount: 1,
			yieldLabel: 'loaf',
			classification: { course: ['Dessert'], season: ['Year-round'] },
			ingredients: [
				'3 ripe bananas',
				'75 g butter, melted',
				'100 g light brown sugar',
				'1 egg',
				'1 tsp vanilla extract',
				'1 tsp bicarbonate of soda',
				'190 g plain flour',
				'1 pinch salt',
			],
			steps: [
				'Heat the oven to 180°C and line a 900 g loaf tin.',
				'Mash the bananas in a bowl. Stir in the butter, sugar, egg and vanilla.',
				'Fold in the bicarbonate of soda, flour and salt until no dry flour shows.',
				'Pour into the tin and bake for 55 to 60 minutes, until a skewer comes out clean.',
				'Leave to cool in the tin for 10 minutes before turning out.',
			],
		},
	],
	staples: ['Olive oil', 'Salt', 'Black pepper', 'Soy sauce', 'Rice'],
	plan: [
		{ day: 0, label: 'dinner', recipes: ['Lemon chicken traybake'] },
		{ day: 1, label: 'dinner', recipes: ['Chickpea and spinach curry'] },
		{
			day: 2,
			label: 'dinner',
			recipes: ['Tomato and basil spaghetti', 'Greek salad'],
		},
		{ day: 3, label: 'dinner', recipes: ['Soy and ginger salmon'] },
		{ day: 4, label: 'dinner', recipes: ['Black bean tacos'] },
		{ day: 5, label: 'breakfast', recipes: ['Mushroom omelette'] },
		{ day: 5, label: 'dinner', recipes: ['Sausage and pepper traybake'] },
		{ day: 6, label: 'dinner', text: 'Leftovers' },
	],
	shopping: {
		manual: [
			{ name: 'coffee beans', horizon: 'next', checked: true },
			{ name: 'dish soap', horizon: 'next' },
			{ name: 'kitchen roll', quantity: '2', horizon: 'later' },
		],
		checkedMealLines: ['spaghetti'],
	},
}
