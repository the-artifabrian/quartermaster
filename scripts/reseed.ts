#!/usr/bin/env tsx

/**
 * Quick script to clear and re-seed the database
 * Usage: npm run reseed
 */

import { prisma } from '#app/utils/db.server.ts'
import { seedSampleData } from '../prisma/seed-sample-data.ts'

async function reseed() {
	console.log('🔄 Re-seeding database...\n')

	// Clear existing data
	console.log('🗑️  Clearing recipes and inventory...')
	const deletedRecipes = await prisma.recipe.deleteMany({})
	const deletedInventory = await prisma.inventoryItem.deleteMany({})
	console.log(
		`  ✅ Deleted ${deletedRecipes.count} recipes, ${deletedInventory.count} inventory items\n`,
	)

	// Get all users
	const users = await prisma.user.findMany({
		select: { id: true, username: true },
	})

	// Seed sample data for each user
	for (const user of users) {
		console.log(`👤 Seeding data for user: ${user.username}`)
		await seedSampleData(user.id)
	}

	console.log('\n✨ Re-seed complete!')
}

async function main() {
	try {
		await reseed()
	} catch (error) {
		console.error('Fatal error:', error)
		process.exit(1)
	} finally {
		await prisma.$disconnect()
	}
}

void main()
