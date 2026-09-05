// Four library comparisons, with real baseline search and entirely synthetic state.
import { rankRecipeSearchMatches } from '../../../app/utils/recipe-search'
type Recipe = {
	id: number
	title: string
	ingredients: { name: string }[]
	time: number | null
	course: string
	favorite: boolean
	cuisine: string
	steps: string[]
}
const names = [
	['Chickpea lunch', 'chickpeas lemon parsley', 20, 'Main', 'Levantine'],
	['Lemon dressing', 'lemon olive oil', 5, 'Dressing', ''],
	['Tomato pasta', 'tomato pasta basil', null, '', 'Italian'],
	['Roast carrots', 'carrots cumin', 40, 'Side', ''],
	['Lentil soup', 'lentils carrot onion', 35, 'Main', ''],
	['Hummus', 'chickpeas tahini lemon', null, 'Dip', 'Levantine'],
	['Walnut pasta', 'walnut pasta garlic', 25, 'Main', 'Italian'],
	['Mushroom rice', 'mushroom rice thyme', 45, 'Main', ''],
	['Potato omelette', 'potato egg onion', 30, 'Main', 'Spanish'],
	['Baked salmon', 'salmon lemon dill', 25, 'Main', ''],
	['Bean stew', 'beans tomato onion', 60, 'Main', ''],
	['Cucumber salad', 'cucumber yogurt dill', 10, 'Side', ''],
	['Pea risotto', 'pea rice parmesan', 40, 'Main', 'Italian'],
	['Tomato toast', 'tomato bread garlic', 10, '', ''],
	['Lemon chicken', 'chicken lemon potato', 75, 'Main', ''],
	['Broccoli noodles', 'broccoli noodles ginger', 20, 'Main', ''],
	['Tahini sauce', 'tahini lemon garlic', 5, 'Dressing', 'Levantine'],
	['Spinach pie', 'spinach feta pastry', 60, 'Main', 'Greek'],
	['Miso aubergine', 'aubergine miso rice', 40, 'Main', ''],
	['Black bean tacos', 'beans tortilla lime', 25, 'Main', 'Mexican'],
	['Roast cauliflower', 'cauliflower cumin lemon', null, '', ''],
	['Couscous bowl', 'couscous chickpeas parsley', 15, 'Main', ''],
	['Chickpea curry', 'chickpeas coconut tomato', 30, 'Main', 'Indian'],
	['Green lentil salad', 'lentils parsley lemon', null, '', ''],
	['Butter beans with greens', 'beans spinach garlic', 20, 'Main', ''],
	['Courgette fritters', 'courgette egg flour', 35, '', ''],
	['Garlic mushrooms', 'mushroom butter garlic', 15, 'Side', ''],
	['Rice and peas', 'rice pea coconut', 30, 'Side', ''],
	['Vegetable tray bake', 'potato carrot onion', 55, 'Main', ''],
	['Sesame noodles', 'noodles sesame cucumber', 15, 'Main', ''],
	['White bean soup', 'beans carrot celery', null, 'Main', ''],
	['Cheese toastie', 'bread cheese butter', 10, '', ''],
	['Yogurt flatbread', 'yogurt flour oil', 25, 'Side', ''],
	['Pepper eggs', 'pepper egg tomato', 25, 'Main', ''],
	['Roast squash', 'squash sage oil', 45, 'Side', ''],
	['Herb oil', 'parsley olive oil', 5, 'Dressing', ''],
] as const
const recipes: Recipe[] = names.map(
	([title, ingredients, time, course, cuisine], id) => ({
		id,
		title,
		time,
		course,
		cuisine,
		ingredients: ingredients.split(' ').map((name) => ({ name })),
		favorite: id % 5 === 0,
		steps: [
			`Prepare the ${ingredients.split(' ').slice(0, 2).join(' and ')}.`,
			'Combine and cook as appropriate; taste and serve. (Fixture instructions.)',
		],
	}),
)
const menus = [
	{
		id: 100,
		title: 'Chickpea supper',
		members: [0, 3, 5],
		note: 'Serve with warm bread.',
	},
	{
		id: 101,
		title: 'Pasta and greens',
		members: [6, 11, 26],
		note: 'Bring sparkling water to the table.',
	},
]
const variants = [
	'A · Current search',
	'B · Clearer search',
	'C · Shuffle one',
	'D · A few choices',
]
let variant = Math.max(
	0,
	'ABCD'.indexOf(new URLSearchParams(location.search).get('variant') || 'A'),
)
let size = 'small',
	query = '',
	maxTime = '',
	course = '',
	favorites = false,
	tab = 'recipes',
	round = 0
let candidates: number[] = [],
	opened: number | null = null,
	cooking = false,
	planning = false
const planned: { title: string; date: string }[] = []
const $ = (id: string) => document.getElementById(id)!
const esc = (s: string) =>
	s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const library = () => recipes.slice(0, size === 'small' ? 6 : 36)
const availableMenus = () =>
	menus.filter((m) =>
		m.members.every((id) => library().some((r) => r.id === id)),
	)
function filtered() {
	return rankRecipeSearchMatches(library(), query).filter(
		(r) =>
			(!maxTime || r.time === null || r.time <= Number(maxTime)) &&
			(!favorites || r.favorite) &&
			(!course || r.course === course),
	)
}
function matchingMenus() {
	const allowed = new Set(filtered().map((r) => r.id))
	return availableMenus().filter((m) => m.members.some((id) => allowed.has(id)))
}
function sample() {
	round++
	const pool = filtered()
	const shuffled = [...pool]
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
	}
	if (variant === 2) {
		candidates = shuffled.slice(0, 1).map((r) => r.id)
		return
	}
	// Opportunistic existing Course data; unknown remains eligible. Never fabricate a pairing.
	const mains = shuffled.filter((r) => r.course === 'Main' || !r.course),
		selected: Recipe[] = []
	for (const r of mains) {
		if (
			selected.length < 2 &&
			!selected.some((s) => s.cuisine && s.cuisine === r.cuisine)
		)
			selected.push(r)
	}
	for (const r of mains) {
		if (selected.length < 2 && !selected.includes(r)) selected.push(r)
	}
	candidates = selected.map((r) => r.id)
	const menu =
		matchingMenus()[Math.floor(Math.random() * matchingMenus().length)]
	if (menu) candidates.push(menu.id)
	else
		for (const r of shuffled) {
			if (candidates.length < 3 && !candidates.includes(r.id))
				candidates.push(r.id)
		}
}
function info(r: Recipe) {
	return `${r.time === null ? 'Time unknown' : r.time + ' min'}${r.favorite ? ' · Favorite' : ''}`
}
function card(id: number) {
	const r = recipes[id],
		m = menus.find((m) => m.id === id)
	return `<article class="candidate"><small>${m ? 'Saved Menu' : esc(r.course || 'Course not entered')}</small><h3>${esc(m?.title || r.title)}</h3><p class="muted">${m ? m.members.map((i) => esc(recipes[i].title)).join(' + ') : info(r)}</p>${m ? '<small>Check all dishes for your constraints; Menu time unknown.</small>' : ''}<p><button data-open="${id}">Open ${m ? 'Menu' : 'Recipe'}</button></p></article>`
}
function render() {
	$('variant').textContent = variants[variant]
	const params = new URLSearchParams(location.search)
	params.set('variant', 'ABCD'[variant])
	history.replaceState(null, '', `?${params}`)
	let html = ''
	if (opened !== null) {
		const r = recipes[opened],
			m = menus.find((m) => m.id === opened)
		html = `<button id="return">Return to choices</button><h1>${esc(m?.title || r.title)}</h1>`
		if (m) {
			html += `<p>Saved Menu · ${esc(m.note)}</p>${m.members.map(card).join('')}<button id="plan">Plan this Menu</button>`
		} else {
			html += `<p>${info(r)} · ${esc(r.course || 'Course not entered')}</p><div class="bar"><button id="cook" class="primary">${cooking ? 'Cooking now' : 'Cook now'}</button><button id="plan">Plan this Recipe</button></div><h2>Ingredients</h2><div class="steps">${r.ingredients.map((i) => `<label><input type="checkbox">${esc(i.name)}</label>`).join('')}</div><h2>Instructions</h2><div class="steps">${r.steps.map((s) => `<label><input type="checkbox">${esc(s)}</label>`).join('')}</div>`
		}
		if (planning)
			html +=
				'<form id="plan-form"><h2>Plan a Meal</h2><label>Date <input id="date" type="date" required></label> <button type="submit">Add to Plan</button></form>'
	} else {
		html = `<h1>My Recipes (${library().length})</h1><div class="bar"><button id="recipes" aria-pressed="${tab === 'recipes'}">Recipes</button><button id="menus" aria-pressed="${tab === 'menus'}">Menus</button></div><input id="query" class="search" type="search" aria-label="Search Recipes" placeholder="${variant === 0 ? 'Search recipes...' : 'Search by name or ingredient'}" value="${esc(query)}"><details><summary>Filters${favorites || maxTime || course ? ' · active' : ''}</summary><div class="bar"><label><input id="favorites" type="checkbox" ${favorites ? 'checked' : ''}>Favorites</label><label>Time <select id="time"><option value="">Any time</option>${[30, 60, 120].map((t) => `<option value="${t}" ${maxTime === String(t) ? 'selected' : ''}>Under ${t} min</option>`).join('')}</select></label><label>Course <select id="course"><option value="">Any Course</option>${['Main', 'Side', 'Dressing', 'Dip'].map((c) => `<option ${course === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><button id="clear">Clear all</button></div></details>`
		if (tab === 'recipes' && variant >= 2) {
			html += `<section><h2>${variant === 2 ? 'Try another saved Recipe' : 'What sounds good?'}</h2><button id="sample" class="primary">${variant === 2 ? 'Shuffle a Recipe' : candidates.length ? 'Show a few others' : 'Show a few choices'}</button>${variant === 3 ? '<p class="muted">Optional. Start with what is saved, or add a clue above.</p>' : ''}${candidates.length ? `<div class="${variant === 3 ? 'choices' : ''}">${candidates.map(card).join('')}</div>` : round ? '<p>No matches. Change your constraints or browse below.</p>' : ''}</section>`
		}
		html +=
			'<section id="library"><h2>' +
			(tab === 'recipes' ? 'Your Recipes' : 'Saved Menus') +
			'</h2>'
		html +=
			tab === 'menus'
				? availableMenus()
						.map((menu) => card(menu.id))
						.join('')
				: filtered()
						.map(
							(r) =>
								`<article class="row"><div class="mono" aria-hidden="true">${r.title[0]}</div><div><h3><button data-open="${r.id}">${esc(r.title)}</button></h3><small>${r.time === null && variant === 0 && !maxTime ? '' : info(r)}</small></div></article>`,
						)
						.join('') ||
					'<p>No matching Recipes. <button id="empty-clear">Clear search and filters</button></p>'
		html += '</section>'
	}
	$('app').innerHTML = html
	$('state').textContent = JSON.stringify(
		{
			variant: variants[variant],
			size,
			query,
			maxTime,
			course,
			favorites,
			tab,
			round,
			candidates: candidates.map(
				(id) => recipes[id]?.title || menus.find((m) => m.id === id)?.title,
			),
			opened,
			cooking,
			planned,
			note: 'No cooking history, availability or persistence. Recently Updated fixture order is editing order only.',
		},
		null,
		2,
	)
	document.querySelectorAll<HTMLElement>('[data-open]').forEach(
		(el) =>
			(el.onclick = () => {
				opened = Number(el.dataset.open)
				cooking = false
				planning = false
				render()
				scrollTo(0, 0)
			}),
	)
	const on = (id: string, fn: () => void) => {
		if (document.getElementById(id)) $(id).onclick = fn
	}
	on('return', () => {
		opened = null
		planning = false
		render()
	})
	on('cook', () => {
		cooking = true
		render()
		$('status').textContent =
			'Fixture cooking mode. Check ingredients and steps directly.'
	})
	on('plan', () => {
		planning = true
		render()
	})
	if (document.getElementById('plan-form'))
		$('plan-form').onsubmit = (e) => {
			e.preventDefault()
			planned.push({
				title:
					recipes[opened!]?.title || menus.find((m) => m.id === opened)!.title,
				date: ($('date') as HTMLInputElement).value,
			})
			planning = false
			render()
			$('status').textContent =
				'Added one fixture Meal to Plan. No Shopping changed.'
		}
	for (const t of ['recipes', 'menus'])
		on(t, () => {
			tab = t
			render()
		})
	on('sample', () => {
		sample()
		render()
	})
	function reset() {
		query = ''
		maxTime = ''
		course = ''
		favorites = false
		candidates = []
		round = 0
		render()
	}
	on('clear', reset)
	on('empty-clear', reset)
	if (document.getElementById('query'))
		($('query') as HTMLInputElement).oninput = (e) => {
			query = (e.target as HTMLInputElement).value
			candidates = []
			round = 0
			render()
			const input = $('query') as HTMLInputElement
			input.focus()
		}
	for (const id of ['favorites', 'time', 'course'])
		if (document.getElementById(id))
			$(id).onchange = (e) => {
				const input = e.target as HTMLInputElement
				if (id === 'favorites') favorites = input.checked
				else if (id === 'time') maxTime = input.value
				else course = input.value
				candidates = []
				round = 0
				render()
			}
}
function switchVariant(delta: number) {
	variant = (variant + delta + 4) % 4
	opened = null
	candidates = []
	round = 0
	render()
}
$('prev').onclick = () => switchVariant(-1)
$('next').onclick = () => switchVariant(1)
$('size').onchange = (e) => {
	size = (e.target as HTMLSelectElement).value
	candidates = []
	opened = null
	round = 0
	render()
}
$('browse').onclick = () => {
	opened = null
	tab = 'recipes'
	render()
}
window.onkeydown = (e) => {
	if (
		(e.target as HTMLElement).closest(
			'input,textarea,select,[contenteditable],button',
		)
	)
		return
	if (e.key === 'ArrowLeft') switchVariant(-1)
	if (e.key === 'ArrowRight') switchVariant(1)
}
render()
