/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { getCurrentWeekStart, getWeekDays, parseDate } from '#app/utils/date.ts'
import { server } from '#tests/mocks/index.ts'
import { type PlanMeal } from './meal-card.tsx'
import { MealPlanCalendar } from './meal-plan-calendar.tsx'

const recipes = [
	{
		id: 'recipe-1',
		title: 'Banana Bread',
		totalTime: 60,
		yieldAmount: 1,
		yieldLabel: 'loaf',
		isFavorite: false,
		image: null,
	},
	{
		id: 'recipe-2',
		title: 'Herb Salad',
		totalTime: 15,
		yieldAmount: 4,
		yieldLabel: 'servings',
		isFavorite: false,
		image: null,
	},
	{
		id: 'recipe-3',
		title: 'Garlic Flatbread',
		totalTime: 25,
		yieldAmount: null,
		yieldLabel: null,
		isFavorite: false,
		image: null,
	},
]

const menus = [
	{
		id: 'menu-1',
		title: 'Friday Supper',
		recipeCount: 2,
		noteCount: 0,
		recipeTitles: ['Herb Salad', 'Garlic Flatbread'],
	},
]

function makeMeal({
	id,
	dateStr,
	title,
}: {
	id: string
	dateStr: string
	title: string
}): PlanMeal {
	return {
		id,
		dateStr,
		label: 'dinner',
		servingAt: null,
		servingTimeZone: null,
		genericText: null,
		completed: false,
		guestCount: null,
		sourceMenu: null,
		sections: [],
		noteItems: [],
		shoppingDemandStatus: 'not-added',
		items: [
			{
				id: `${id}-item`,
				recipeTitle: title,
				scaleMultiplier: 1,
				cooked: false,
				note: null,
				order: 0,
				sectionId: null,
				recipe: {
					id: `${id}-recipe`,
					title,
					yieldAmount: 4,
					yieldLabel: 'servings',
					totalTime: 30,
					image: null,
				},
			},
		],
	}
}

const weekDays = getWeekDays(parseDate('2026-04-06'))
const meals = [
	makeMeal({ id: 'meal-1', dateStr: '2026-04-08', title: 'Banana Bread' }),
	makeMeal({ id: 'meal-2', dateStr: '2026-04-09', title: 'Bolognese' }),
]

function renderCalendar(
	action: ({ request }: { request: Request }) => unknown = () => null,
	options: {
		calendarWeekDays?: Date[]
		calendarMeals?: PlanMeal[]
		useDefaultChoices?: boolean
	} = {},
) {
	if (options.useDefaultChoices !== false) {
		server.use(
			http.get('*/resources/plan-choices', () =>
				HttpResponse.json({ recipes, menus }),
			),
		)
	}
	const calendarWeekDays = options.calendarWeekDays ?? weekDays
	const calendarMeals = options.calendarMeals ?? meals
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<MealPlanCalendar weekDays={calendarWeekDays} meals={calendarMeals} />
			),
			action,
		},
	])
	render(<Stub />)
}

test('mobile focuses the first planned day and switches days without a long agenda', async () => {
	const user = userEvent.setup()
	renderCalendar(undefined, { useDefaultChoices: false })
	const mobile = screen.getByTestId('mobile-plan')
	const wednesday = within(mobile).getByRole('button', {
		name: 'Show Wednesday, Apr 8, 1 Meal planned',
	})
	const thursday = within(mobile).getByRole('button', {
		name: 'Show Thursday, Apr 9, 1 Meal planned',
	})
	const monday = within(mobile).getByRole('button', {
		name: 'Show Monday, Apr 6, no Meals planned',
	})
	const weekPicker = mobile.querySelector('[data-slot="mobile-week-days"]')

	expect(weekPicker).toHaveClass('grid-cols-7')
	expect(within(weekPicker as HTMLElement).getAllByRole('button')).toHaveLength(
		7,
	)
	expect(within(mobile).getByRole('heading', { name: 'Apr 8' })).toBeVisible()
	expect(within(mobile).getByText('Banana Bread')).toBeVisible()
	expect(within(mobile).queryByText('Bolognese')).not.toBeInTheDocument()
	expect(wednesday).toHaveAttribute('aria-pressed', 'true')
	expect(wednesday).toHaveClass('bg-primary', 'ring-2')
	expect(thursday).toHaveAttribute('aria-pressed', 'false')
	expect(monday).toHaveAccessibleName('Show Monday, Apr 6, no Meals planned')

	await user.click(thursday)

	expect(within(mobile).getByRole('heading', { name: 'Apr 9' })).toBeVisible()
	expect(within(mobile).getByText('Bolognese')).toBeVisible()
	expect(within(mobile).queryByText('Banana Bread')).not.toBeInTheDocument()
	expect(wednesday).toHaveAttribute('aria-pressed', 'false')
	expect(thursday).toHaveAttribute('aria-pressed', 'true')
	expect(thursday).toHaveClass('bg-primary', 'ring-2')
})

test('shares one in-flight and successful choice request across Plan controls', async () => {
	let requestCount = 0
	let releaseResponse = () => {}
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve
	})
	server.use(
		http.get('*/resources/plan-choices', async () => {
			requestCount++
			await responseGate
			return HttpResponse.json({ recipes, menus })
		}),
	)
	const user = userEvent.setup()
	renderCalendar(undefined, { useDefaultChoices: false })
	const mobile = screen.getByTestId('mobile-plan')
	const desktop = screen.getByTestId('desktop-plan')

	expect(requestCount).toBe(0)
	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	expect(within(mobile).getByRole('status')).toHaveTextContent(
		'Loading Recipes and Menus',
	)
	await user.click(
		within(desktop).getByRole('button', {
			name: 'Add Meal to Monday, Apr 6',
		}),
	)
	expect(within(desktop).getByRole('status')).toHaveTextContent(
		'Loading Recipes and Menus',
	)
	expect(requestCount).toBe(1)

	releaseResponse()
	await within(mobile).findByPlaceholderText('Search Recipes and Menus...')
	await within(desktop).findByPlaceholderText('Search Recipes and Menus...')
	await user.click(within(mobile).getByRole('button', { name: 'Close picker' }))
	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	expect(
		within(mobile).getByPlaceholderText('Search Recipes and Menus...'),
	).toBeVisible()
	expect(requestCount).toBe(1)
})

test('keeps text-only Meal creation available while choice loading retries', async () => {
	let requestCount = 0
	let releaseRetry = () => {}
	const retryGate = new Promise<void>((resolve) => {
		releaseRetry = resolve
	})
	server.use(
		http.get('*/resources/plan-choices', async () => {
			requestCount++
			if (requestCount === 1) return new HttpResponse(null, { status: 503 })
			await retryGate
			return HttpResponse.json({ recipes: [], menus: [] })
		}),
	)
	let submitted: Record<string, FormDataEntryValue> = {}
	renderCalendar(
		async ({ request }) => {
			submitted = Object.fromEntries(await request.formData())
			return { status: 'success' as const }
		},
		{ useDefaultChoices: false },
	)
	const user = userEvent.setup()
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	const composer = within(mobile).getByRole('region', {
		name: 'Add Meal for Wednesday, Apr 8',
	})
	expect(await within(composer).findByRole('alert')).toHaveTextContent(
		'Couldn’t load Recipes and Menus',
	)
	await user.click(within(composer).getByRole('button', { name: 'Try again' }))
	expect(within(composer).getByRole('status')).toHaveTextContent(
		'Loading Recipes and Menus',
	)
	await user.click(
		within(composer).getByRole('button', { name: /Add text instead/ }),
	)
	await user.type(within(composer).getByRole('textbox'), 'Leftovers')
	await user.click(within(composer).getByRole('button', { name: 'Add' }))

	await waitFor(() =>
		expect(submitted).toMatchObject({
			intent: 'addTextMeal',
			date: '2026-04-08',
			text: 'Leftovers',
		}),
	)
	releaseRetry()
	expect(requestCount).toBe(2)
})

test('shows the existing empty choice state after a successful request', async () => {
	server.use(
		http.get('*/resources/plan-choices', () =>
			HttpResponse.json({ recipes: [], menus: [] }),
		),
	)
	const user = userEvent.setup()
	renderCalendar(undefined, { useDefaultChoices: false })
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	expect(
		await within(mobile).findByText('No Recipes or Menus found'),
	).toBeVisible()
	expect(
		within(mobile).getByRole('link', { name: 'Create a new recipe' }),
	).toBeVisible()
})

test('reuses the shared choices for Add another Recipe and excludes Meal Recipes', async () => {
	let requestCount = 0
	server.use(
		http.get('*/resources/plan-choices', () => {
			requestCount++
			return HttpResponse.json({
				recipes: [{ ...recipes[0], id: 'meal-1-recipe' }, ...recipes.slice(1)],
				menus,
			})
		}),
	)
	let submitted: Record<string, FormDataEntryValue> = {}
	renderCalendar(
		async ({ request }) => {
			submitted = Object.fromEntries(await request.formData())
			return { status: 'success' as const }
		},
		{ useDefaultChoices: false },
	)
	const user = userEvent.setup()
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	await within(mobile).findByPlaceholderText('Search Recipes and Menus...')
	await user.click(within(mobile).getByRole('button', { name: 'Close picker' }))
	await user.click(
		within(mobile).getByRole('button', {
			name: 'Meal actions for Banana Bread',
		}),
	)
	await user.click(await screen.findByRole('menuitem', { name: 'Add Recipe' }))

	const search = within(mobile).getByPlaceholderText('Search recipes...')
	const picker = search.closest('.space-y-2')
	expect(picker).not.toBeNull()
	expect(
		within(picker as HTMLElement).queryByRole('button', {
			name: /Banana Bread/,
		}),
	).not.toBeInTheDocument()
	await user.click(
		within(picker as HTMLElement).getByRole('button', { name: /Herb Salad/ }),
	)

	await waitFor(() =>
		expect(submitted).toMatchObject({
			intent: 'addRecipeToMeal',
			mealId: 'meal-1',
			recipeId: 'recipe-2',
		}),
	)
	expect(requestCount).toBe(1)
})

test('mobile Add Meal opens the real picker inline for the selected day', async () => {
	const user = userEvent.setup()
	let submittedDate: FormDataEntryValue | null = null
	renderCalendar(async ({ request }) => {
		const formData = await request.formData()
		submittedDate = formData.get('date')
		return null
	})
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	const composer = within(mobile).getByRole('region', {
		name: 'Add Meal for Wednesday, Apr 8',
	})
	expect(composer).toBeVisible()
	expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	expect(within(composer).getByText('Wednesday · Apr 8')).toBeVisible()
	expect(within(composer).getByText(/Meal type/)).toHaveTextContent(
		'Meal type (optional)',
	)
	await user.type(
		await within(composer).findByPlaceholderText('Search Recipes and Menus...'),
		'hreb salad',
	)
	expect(within(composer).queryByText('Banana Bread')).not.toBeInTheDocument()
	await user.click(within(composer).getByRole('button', { name: /Herb Salad/ }))

	await waitFor(() => expect(submittedDate).toBe('2026-04-08'))
})

test('mobile finds a saved Menu by one of its Recipes and adds it to the selected day', async () => {
	const user = userEvent.setup()
	let submitted: Record<string, FormDataEntryValue> = {}
	renderCalendar(async ({ request }) => {
		submitted = Object.fromEntries(await request.formData())
		return { status: 'success' as const }
	})
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	const composer = within(mobile).getByRole('region', {
		name: 'Add Meal for Wednesday, Apr 8',
	})
	await user.click(within(composer).getByRole('button', { name: 'Dinner' }))
	await user.type(
		await within(composer).findByPlaceholderText('Search Recipes and Menus...'),
		'garlic flatbrad',
	)

	expect(within(composer).getByText('Menus')).toBeVisible()
	const recipeChoice = within(composer).getByRole('button', {
		name: /Garlic Flatbread/,
	})
	const menuChoice = within(composer).getByRole('button', {
		name: /Friday Supper/,
	})
	expect(
		recipeChoice.compareDocumentPosition(menuChoice) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy()
	await user.click(menuChoice)

	await waitFor(() =>
		expect(submitted).toMatchObject({
			intent: 'addMenu',
			date: '2026-04-08',
			menuId: 'menu-1',
			label: 'dinner',
		}),
	)
	await waitFor(() =>
		expect(
			within(mobile).queryByRole('region', {
				name: 'Add Meal for Wednesday, Apr 8',
			}),
		).not.toBeInTheDocument(),
	)
})

test('mobile explains a stale empty Menu and lets the user retry', async () => {
	const user = userEvent.setup()
	let attempts = 0
	renderCalendar(async () => {
		attempts++
		return attempts === 1
			? {
					status: 'error' as const,
					menuError:
						'This Menu has nothing to plan yet—add a Recipe or note first.',
				}
			: { status: 'success' as const }
	})
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	const composer = within(mobile).getByRole('region', {
		name: 'Add Meal for Wednesday, Apr 8',
	})
	await within(composer).findByPlaceholderText('Search Recipes and Menus...')
	await user.click(
		within(composer).getByRole('button', { name: /Friday Supper/ }),
	)

	expect(await within(composer).findByRole('alert')).toHaveTextContent(
		'This Menu has nothing to plan yet—add a Recipe or note first.',
	)
	expect(
		within(mobile).getByRole('region', {
			name: 'Add Meal for Wednesday, Apr 8',
		}),
	).toBeVisible()
	expect(
		within(composer).getByRole('button', { name: /Friday Supper/ }),
	).toBeEnabled()

	await user.click(
		within(composer).getByRole('button', { name: /Friday Supper/ }),
	)
	await waitFor(() =>
		expect(
			within(mobile).queryByRole('region', {
				name: 'Add Meal for Wednesday, Apr 8',
			}),
		).not.toBeInTheDocument(),
	)
	expect(attempts).toBe(2)
})

test('mobile closes an open Add Meal draft when the selected day changes', async () => {
	const user = userEvent.setup()
	renderCalendar()
	const mobile = screen.getByTestId('mobile-plan')

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Wednesday, Apr 8',
		}),
	)
	const composer = within(mobile).getByRole('region', {
		name: 'Add Meal for Wednesday, Apr 8',
	})
	await user.click(within(composer).getByRole('button', { name: 'Dinner' }))

	await user.click(
		within(mobile).getByRole('button', {
			name: 'Show Thursday, Apr 9, 1 Meal planned',
		}),
	)

	expect(
		within(mobile).queryByRole('region', { name: /Add Meal for/ }),
	).not.toBeInTheDocument()
	expect(
		within(mobile).getByRole('button', {
			name: 'Add Meal to Thursday, Apr 9',
		}),
	).toBeVisible()
})

test('desktop keeps the entire week in one chronological agenda', () => {
	renderCalendar()
	const desktop = screen.getByTestId('desktop-plan')

	expect(within(desktop).getByText('Monday')).toBeInTheDocument()
	expect(within(desktop).getByText('Sunday')).toBeInTheDocument()
	expect(within(desktop).getByText('Banana Bread')).toBeInTheDocument()
	expect(within(desktop).getByText('Bolognese')).toBeInTheDocument()
	expect(within(desktop).getAllByText('Nothing planned')).toHaveLength(5)
	expect(
		within(desktop).getByRole('button', {
			name: 'Add Meal to Monday, Apr 6',
		}),
	).toHaveTextContent(/Nothing planned\s*Add Meal/)
	expect(
		within(desktop).getByRole('button', {
			name: 'Meal actions for Banana Bread',
		}),
	).toBeVisible()
})

test('desktop Meal boundaries stay distinct when a day contains several Meals', () => {
	renderCalendar(undefined, {
		calendarMeals: [
			{
				...makeMeal({
					id: 'meal-1',
					dateStr: '2026-04-08',
					title: 'Banana Bread',
				}),
				label: null,
			},
			{
				...makeMeal({
					id: 'meal-2',
					dateStr: '2026-04-08',
					title: 'Bolognese',
				}),
				label: null,
			},
		],
	})
	const desktop = screen.getByTestId('desktop-plan')
	const mealGroups = desktop.querySelectorAll('[data-slot="meal-group"]')

	expect(mealGroups).toHaveLength(2)
	expect(mealGroups[1]).toHaveClass('md:mt-2', 'md:border-t', 'md:pt-2')
	expect(within(desktop).getAllByText('Meal', { exact: true })).toHaveLength(2)
})

test('a Meal with snapshot notes can remove its only Recipe', () => {
	const meal = makeMeal({
		id: 'meal-with-note',
		dateStr: '2026-04-08',
		title: 'Banana Bread',
	})
	meal.noteItems = [
		{
			id: 'note-1',
			text: 'Serve with cultured butter',
			order: 1,
			sectionId: null,
			shoppingLines: [],
		},
	]
	renderCalendar(undefined, { calendarMeals: [meal] })
	const desktop = screen.getByTestId('desktop-plan')

	expect(
		within(desktop).getByRole('button', {
			name: 'Remove Banana Bread from this meal',
		}),
	).toBeVisible()
})

test('desktop Today marker does not shift the day and content columns', () => {
	renderCalendar(undefined, {
		calendarWeekDays: getWeekDays(getCurrentWeekStart()),
		calendarMeals: [],
	})
	const desktop = screen.getByTestId('desktop-plan')
	const todaySection = within(desktop).getByText('Today').closest('section')

	expect(todaySection).not.toHaveClass('border-l-4')
	expect(todaySection).toHaveClass('before:w-1', 'before:absolute')
})
