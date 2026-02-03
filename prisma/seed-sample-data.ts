import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '#app/utils/db.server.ts'

// Function to clean text by removing markdown links
function cleanText(text: string): string {
	return text
		.replace(/\+\+\[([^\]]+)\]\([^)]+\)\+\+/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.trim()
}

// Common cooking units - only these should be treated as units
const COMMON_UNITS = new Set([
	'g', 'kg', 'mg', 'oz', 'lb', 'lbs', 'pound', 'pounds',
	'ml', 'l', 'liter', 'liters', 'litre', 'litres', 'gallon', 'gallons', 'quart', 'quarts', 'pint', 'pints',
	'cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'tsp', 'teaspoon', 'teaspoons',
	'can', 'cans', 'jar', 'jars', 'bottle', 'bottles', 'package', 'packages', 'box', 'boxes',
	'slice', 'slices', 'piece', 'pieces', 'whole', 'half', 'halves', 'clove', 'cloves',
	'bunch', 'bunches', 'head', 'heads', 'stalk', 'stalks', 'sprig', 'sprigs',
	'pinch', 'dash', 'handful',
])

// Function to parse ingredient line
function parseIngredient(line: string): {
	name: string
	amount?: string
	unit?: string
	notes?: string
} | null {
	const cleaned = cleanText(line.replace(/^-\s*\[[ x]\]\s*/, '').trim())
	if (!cleaned) return null

	// Try to match: amount + optional unit + name
	// Handle both "600 g broccoli" and "600g broccoli"
	const match = cleaned.match(/^([\d.\/\-–]+)\s*([a-zA-Z]+)?\s+(.+)$/)

	if (match) {
		const amount = match[1]
		const possibleUnit = match[2]
		let remainder = match[3]?.trim() || ''
		let unit: string | undefined = undefined
		let name = ''
		let notes: string | undefined = undefined

		// Check if the matched word is a valid unit
		if (possibleUnit && COMMON_UNITS.has(possibleUnit.toLowerCase())) {
			unit = possibleUnit
			name = remainder
		} else if (possibleUnit) {
			// If it's not a valid unit, it's part of the ingredient name
			name = possibleUnit + ' ' + remainder
		} else {
			// Check if the first word of remainder is a valid unit
			const words = remainder.split(/\s+/)
			if (words.length > 1 && words[0] && COMMON_UNITS.has(words[0].toLowerCase())) {
				unit = words[0]
				name = words.slice(1).join(' ')
			} else {
				name = remainder
			}
		}

		// Split name on comma to extract notes
		if (name && name.includes(',')) {
			const parts = name.split(',').map(s => s.trim())
			name = parts[0] || ''
			notes = parts.slice(1).join(', ')
		}

		return { name: name?.trim() || '', amount, unit, notes }
	}

	// For ingredients without amounts, also check for comma-separated notes
	let name = cleaned
	let notes: string | undefined = undefined

	if (cleaned.includes(',')) {
		const parts = cleaned.split(',').map(s => s.trim())
		name = parts[0] || ''
		notes = parts.slice(1).join(', ')
	}

	return { name, notes }
}

// Function to parse a recipe markdown file
async function parseRecipeFile(filePath: string) {
	const content = await fs.readFile(filePath, 'utf-8')
	const lines = content.split('\n')

	let title = ''
	let currentSection: 'none' | 'ingredients' | 'instructions' = 'none'
	const ingredients: Array<{ name: string; amount?: string; unit?: string; notes?: string }> =
		[]
	const instructions: string[] = []

	for (let line of lines) {
		line = line.trim()

		if (line.startsWith('# ') && !title) {
			title = line.replace(/^#\s+/, '').trim()
			currentSection = 'ingredients'
			continue
		}

		if (line.match(/^##\s+(Ingredients?)/i)) {
			currentSection = 'ingredients'
			continue
		}
		if (line.match(/^##\s+(Instructions?|Method|Steps?)/i)) {
			currentSection = 'instructions'
			continue
		}

		if (currentSection === 'ingredients' && line.startsWith('- ')) {
			const ingredient = parseIngredient(line)
			if (ingredient) {
				ingredients.push(ingredient)
			}
		}

		if (currentSection === 'instructions' && line.startsWith('- ')) {
			const instruction = cleanText(line.replace(/^-\s*\[[ x]\]\s*/, ''))
			if (instruction) {
				instructions.push(instruction)
			}
		}
	}

	return { title, ingredients, instructions }
}

// Sample inventory items based on common recipe ingredients
const SAMPLE_INVENTORY = {
	pantry: [
		{ name: 'all-purpose flour', quantity: 1000, unit: 'g' },
		{ name: 'sugar', quantity: 500, unit: 'g' },
		{ name: 'salt', quantity: 1, unit: 'container' },
		{ name: 'black pepper', quantity: 1, unit: 'container' },
		{ name: 'olive oil', quantity: 500, unit: 'ml' },
		{ name: 'vegetable oil', quantity: 500, unit: 'ml' },
		{ name: 'soy sauce', quantity: 250, unit: 'ml' },
		{ name: 'rice', quantity: 1000, unit: 'g' },
		{ name: 'pasta', quantity: 500, unit: 'g' },
		{ name: 'canned tomatoes', quantity: 2, unit: 'cans' },
		{ name: 'chicken stock', quantity: 1, unit: 'liter' },
		{ name: 'honey', quantity: 250, unit: 'g' },
		{ name: 'sesame oil', quantity: 100, unit: 'ml' },
		{ name: 'rice vinegar', quantity: 200, unit: 'ml' },
		{ name: 'baking powder', quantity: 100, unit: 'g' },
		{ name: 'vanilla extract', quantity: 50, unit: 'ml' },
	],
	fridge: [
		{ name: 'eggs', quantity: 12, unit: 'count' },
		{ name: 'butter', quantity: 250, unit: 'g' },
		{ name: 'milk', quantity: 1, unit: 'liter' },
		{ name: 'heavy cream', quantity: 500, unit: 'ml' },
		{ name: 'parmesan cheese', quantity: 200, unit: 'g' },
		{ name: 'mozzarella', quantity: 200, unit: 'g' },
		{ name: 'yogurt', quantity: 500, unit: 'g' },
		{ name: 'carrots', quantity: 5, unit: 'count' },
		{ name: 'celery', quantity: 1, unit: 'bunch' },
		{ name: 'onions', quantity: 3, unit: 'count' },
		{ name: 'garlic', quantity: 1, unit: 'head' },
		{ name: 'ginger', quantity: 100, unit: 'g' },
		{ name: 'scallions', quantity: 1, unit: 'bunch' },
		{ name: 'bell peppers', quantity: 2, unit: 'count' },
		{ name: 'broccoli', quantity: 1, unit: 'head' },
		{ name: 'lettuce', quantity: 1, unit: 'head' },
	],
	freezer: [
		{ name: 'chicken breast', quantity: 500, unit: 'g' },
		{ name: 'ground beef', quantity: 500, unit: 'g' },
		{ name: 'bacon', quantity: 200, unit: 'g' },
		{ name: 'peas', quantity: 300, unit: 'g' },
		{ name: 'mixed vegetables', quantity: 500, unit: 'g' },
		{ name: 'pizza dough', quantity: 2, unit: 'portions' },
	],
}

export async function seedSampleData(userId: string) {
	console.log(`\n🌱 Seeding sample data for user ${userId}`)

	// Seed recipes
	const recipesDir = path.join(process.cwd(), 'sample-recipes')
	const files = await fs.readdir(recipesDir)
	const mdFiles = files.filter((f) => f.endsWith('.md'))

	console.log(`\n📚 Seeding ${mdFiles.length} sample recipes...`)

	let recipesCreated = 0
	for (const file of mdFiles) {
		try {
			const filePath = path.join(recipesDir, file)
			const recipe = await parseRecipeFile(filePath)

			if (!recipe.title || recipe.ingredients.length === 0) {
				continue
			}

			await prisma.recipe.create({
				data: {
					title: recipe.title,
					userId,
					ingredients: {
						create: recipe.ingredients.map((ing, index) => ({
							name: ing.name,
							amount: ing.amount || null,
							unit: ing.unit || null,
							notes: ing.notes || null,
							order: index,
						})),
					},
					instructions: {
						create: recipe.instructions.map((content, index) => ({
							content,
							order: index,
						})),
					},
				},
			})
			recipesCreated++
		} catch (error) {
			console.error(`  ⚠️  Error seeding ${file}:`, error)
		}
	}
	console.log(`  ✅ Created ${recipesCreated} recipes`)

	// Seed inventory items
	console.log(`\n🏪 Seeding sample inventory...`)

	let inventoryCreated = 0
	for (const [location, items] of Object.entries(SAMPLE_INVENTORY)) {
		for (const item of items) {
			await prisma.inventoryItem.create({
				data: {
					name: item.name,
					location,
					quantity: item.quantity,
					unit: item.unit,
					userId,
					lowStock: false,
				},
			})
			inventoryCreated++
		}
	}
	console.log(
		`  ✅ Created ${inventoryCreated} inventory items (${SAMPLE_INVENTORY.pantry.length} pantry, ${SAMPLE_INVENTORY.fridge.length} fridge, ${SAMPLE_INVENTORY.freezer.length} freezer)`,
	)

	console.log(`\n✨ Sample data seeding complete!`)
}
