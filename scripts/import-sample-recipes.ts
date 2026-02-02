#!/usr/bin/env tsx

import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '#app/utils/db.server.ts'

// Function to clean text by removing markdown links like ++[text](url)++
function cleanText(text: string): string {
	return text
		.replace(/\+\+\[([^\]]+)\]\([^)]+\)\+\+/g, '$1') // Remove ++[text](url)++
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove [text](url)
		.trim()
}

// Function to parse ingredient line
function parseIngredient(line: string): {
	name: string
	amount?: string
	unit?: string
} | null {
	const cleaned = cleanText(line.replace(/^-\s*\[[ x]\]\s*/, '').trim())
	if (!cleaned) return null

	// Try to parse amount and unit from the beginning
	// Patterns: "400g", "1/2 teaspoon", "2-3 tbsp", "400ml", "1 tablespoon", etc.
	const match = cleaned.match(
		/^([\d.\/\-–]+)\s*([a-zA-Z]+)?\s+(.+)$|^([\d.\/\-–]+)\s*([a-zA-Z]+)\s+(.+)$/,
	)

	if (match) {
		const amount = match[1] || match[4]
		const unit = match[2] || match[5]
		const name = match[3] || match[6]
		return { name: name.trim(), amount, unit: unit || undefined }
	}

	// If no pattern matched, treat whole thing as name
	return { name: cleaned }
}

// Function to parse a recipe markdown file
async function parseRecipeFile(filePath: string) {
	const content = await fs.readFile(filePath, 'utf-8')
	const lines = content.split('\n')

	let title = ''
	let currentSection: 'none' | 'ingredients' | 'instructions' = 'none'
	const ingredients: Array<{ name: string; amount?: string; unit?: string }> =
		[]
	const instructions: string[] = []

	for (let line of lines) {
		line = line.trim()

		// Extract title
		if (line.startsWith('# ') && !title) {
			title = line.replace(/^#\s+/, '').trim()
			// If no section headers exist, default to ingredients after title
			currentSection = 'ingredients'
			continue
		}

		// Section headers
		if (line.match(/^##\s+(Ingredients?)/i)) {
			currentSection = 'ingredients'
			continue
		}
		if (line.match(/^##\s+(Instructions?|Method|Steps?)/i)) {
			currentSection = 'instructions'
			continue
		}

		// Parse ingredients
		if (currentSection === 'ingredients' && line.startsWith('- ')) {
			const ingredient = parseIngredient(line)
			if (ingredient) {
				ingredients.push(ingredient)
			}
		}

		// Parse instructions
		if (currentSection === 'instructions' && line.startsWith('- ')) {
			const instruction = cleanText(line.replace(/^-\s*\[[ x]\]\s*/, ''))
			if (instruction) {
				instructions.push(instruction)
			}
		}
	}

	return { title, ingredients, instructions }
}

// Main import function
async function importRecipes(userId: string) {
	const recipesDir = path.join(process.cwd(), 'sample-recipes')
	const files = await fs.readdir(recipesDir)
	const mdFiles = files.filter((f) => f.endsWith('.md'))

	console.log(`Found ${mdFiles.length} recipe files to import\n`)

	for (const file of mdFiles) {
		try {
			console.log(`Importing: ${file}`)
			const filePath = path.join(recipesDir, file)
			const recipe = await parseRecipeFile(filePath)

			if (!recipe.title) {
				console.log(`  ⚠️  Skipped: No title found`)
				continue
			}

			if (recipe.ingredients.length === 0) {
				console.log(`  ⚠️  Skipped: No ingredients found`)
				continue
			}

			// Check if recipe already exists
			const existing = await prisma.recipe.findFirst({
				where: {
					title: recipe.title,
					userId,
				},
			})

			if (existing) {
				console.log(`  ⏭️  Skipped: Recipe already exists`)
				continue
			}

			// Create recipe
			await prisma.recipe.create({
				data: {
					title: recipe.title,
					userId,
					ingredients: {
						create: recipe.ingredients.map((ing, index) => ({
							name: ing.name,
							amount: ing.amount || null,
							unit: ing.unit || null,
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

			console.log(
				`  ✅ Imported: ${recipe.ingredients.length} ingredients, ${recipe.instructions.length} steps`,
			)
		} catch (error) {
			console.error(`  ❌ Error importing ${file}:`, error)
		}
	}

	console.log('\n✨ Import complete!')
}

// Get the first user ID from the database
async function getFirstUserId(): Promise<string | null> {
	const user = await prisma.user.findFirst({
		select: { id: true, email: true },
	})
	if (user) {
		console.log(`Using user: ${user.email}\n`)
		return user.id
	}
	return null
}

// Run the import
async function main() {
	try {
		const userId = await getFirstUserId()
		if (!userId) {
			console.error('❌ No user found in database. Please create a user first.')
			process.exit(1)
		}

		await importRecipes(userId)
	} catch (error) {
		console.error('Fatal error:', error)
		process.exit(1)
	} finally {
		await prisma.$disconnect()
	}
}

main()
