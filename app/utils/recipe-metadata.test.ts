import { describe, expect, test } from 'vitest'
import {
	RecipeMetadataNameSchema,
	groupRecipeMetadataValues,
	recipeMetadataName,
	recipeMetadataNameKey,
} from './recipe-metadata.ts'

describe('Recipe classification vocabulary', () => {
	test('normalizes display names and case-insensitive identity predictably', () => {
		expect(recipeMetadataName('  Northern\t Italian  ')).toBe(
			'Northern Italian',
		)
		expect(recipeMetadataNameKey('  Ｌｅｖａｎｔｉｎｅ  ')).toBe('levantine')
		expect(recipeMetadataNameKey('Year-Round')).toBe('year-round')
	})

	test('rejects empty or oversized custom values after normalization', () => {
		expect(RecipeMetadataNameSchema.safeParse('   ').success).toBe(false)
		expect(RecipeMetadataNameSchema.safeParse('x'.repeat(51)).success).toBe(
			false,
		)
		expect(RecipeMetadataNameSchema.parse('  Main  ')).toBe('Main')
	})

	test('groups only the three supported dimensions', () => {
		const groups = groupRecipeMetadataValues([
			{ dimension: 'cuisine', name: 'Romanian' },
			{ dimension: 'season', name: 'Winter' },
			{ dimension: 'tag', name: 'Not part of the model' },
		])
		expect(groups.cuisine.map((value) => value.name)).toEqual(['Romanian'])
		expect(groups.season.map((value) => value.name)).toEqual(['Winter'])
		expect(groups.course).toEqual([])
	})
})
