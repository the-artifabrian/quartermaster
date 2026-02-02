#!/usr/bin/env tsx

import { prisma } from '#app/utils/db.server.ts'

async function clearRecipes() {
	console.log('🗑️  Deleting all recipes and inventory items...')

	// Delete all recipes (this will cascade delete ingredients, instructions, images)
	const deletedRecipes = await prisma.recipe.deleteMany({})
	console.log(`✅ Deleted ${deletedRecipes.count} recipes`)

	// Delete all inventory items
	const deletedInventory = await prisma.inventoryItem.deleteMany({})
	console.log(`✅ Deleted ${deletedInventory.count} inventory items`)

	console.log('\n✨ Database cleared!')
}

async function main() {
	try {
		await clearRecipes()
	} catch (error) {
		console.error('Fatal error:', error)
		process.exit(1)
	} finally {
		await prisma.$disconnect()
	}
}

void main()
