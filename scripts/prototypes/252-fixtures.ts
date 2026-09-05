export type Line = {
	name: string
	amount: number | null
	unit: string
	staple?: 'normal' | 'out'
}
export const dishes: { title: string; scale: number; lines: Line[] }[] = [
	{
		title: 'Chickpea salad',
		scale: 1,
		lines: [
			{ name: 'chickpeas', amount: 400, unit: 'g' },
			{ name: 'lemon', amount: 1, unit: '' },
			{ name: 'olive oil', amount: 2, unit: 'tbsp', staple: 'normal' },
		],
	},
	{
		title: 'Lemon rice',
		scale: 2,
		lines: [
			{ name: 'rice', amount: 200, unit: 'g' },
			{ name: 'lemon', amount: 0.5, unit: '' },
			{ name: 'garlic', amount: 2, unit: 'cloves', staple: 'out' },
		],
	},
	{
		title: 'Rice-stuffed peppers',
		scale: 1,
		lines: [
			{ name: 'rice', amount: 0.2, unit: 'kg' },
			{ name: 'peppers', amount: 4, unit: '' },
			{ name: 'herbs', amount: null, unit: 'handful, to taste' },
		],
	},
	{
		title: 'Yogurt dip',
		scale: 0.5,
		lines: [
			{ name: 'yogurt', amount: 400, unit: 'g' },
			{ name: 'garlic', amount: 2, unit: 'cloves', staple: 'out' },
			{ name: 'olive oil', amount: 2, unit: 'tbsp', staple: 'normal' },
		],
	},
]
export const notes: Line[] = [
	{ name: 'sparkling water', amount: 2, unit: 'bottles' },
	{ name: 'ice', amount: null, unit: 'one bag if hot' },
]
