import { describe, it, expect } from 'vitest'
import {
	buildEnhancePrompt,
	parseEnhanceResponse,
	type RecipeInput,
} from './recipe-enhance-llm.server.ts'

const sampleInput: RecipeInput = {
	title: 'Pasta Carbonara',
	description: null,
	servings: 4,
	prepTime: null,
	cookTime: null,
	currentTags: ['Italian'],
	ingredients: [
		{ name: 'spaghetti', amount: '400', unit: 'g' },
		{ name: 'guanciale', amount: '200', unit: 'g' },
		{ name: 'egg yolks', amount: '6', unit: null },
		{ name: 'pecorino romano', amount: '100', unit: 'g' },
		{ name: 'black pepper', amount: null, unit: null },
	],
	instructions: [
		{ content: 'Boil a large pot of salted water and cook spaghetti.' },
		{ content: 'Cut guanciale into strips and cook until crispy, about 8 minutes.' },
		{ content: 'Mix egg yolks with grated pecorino and pepper.' },
		{ content: 'Toss hot pasta with guanciale, then add egg mixture off heat.' },
	],
}

describe('buildEnhancePrompt', () => {
	it('includes title, ingredients, and instructions', () => {
		const prompt = buildEnhancePrompt(sampleInput)
		expect(prompt).toContain('Pasta Carbonara')
		expect(prompt).toContain('spaghetti')
		expect(prompt).toContain('guanciale')
		expect(prompt).toContain('Boil a large pot')
		expect(prompt).toContain('Current tags: Italian')
	})

	it('shows "None" for missing fields', () => {
		const prompt = buildEnhancePrompt(sampleInput)
		expect(prompt).toContain('Current description: None')
		expect(prompt).toContain('Current prep time: None')
		expect(prompt).toContain('Current cook time: None')
	})

	it('shows existing values when present', () => {
		const input: RecipeInput = {
			...sampleInput,
			description: 'A classic Roman pasta dish',
			prepTime: 10,
			cookTime: 20,
		}
		const prompt = buildEnhancePrompt(input)
		expect(prompt).toContain('Current description: A classic Roman pasta dish')
		expect(prompt).toContain('Current prep time: 10 minutes')
		expect(prompt).toContain('Current cook time: 20 minutes')
	})

	it('lists valid tag names', () => {
		const prompt = buildEnhancePrompt(sampleInput)
		expect(prompt).toContain('Italian')
		expect(prompt).toContain('Vegetarian')
		expect(prompt).toContain('Gluten-Free')
	})
})

describe('parseEnhanceResponse', () => {
	it('parses valid JSON response', () => {
		const text = JSON.stringify({
			description: 'A rich, creamy Roman pasta with guanciale and pecorino.',
			servings: 4,
			prepTime: 10,
			cookTime: 15,
			suggestedTags: ['Dinner'],
		})
		const result = parseEnhanceResponse(text, ['Italian'])
		expect(result).toEqual({
			description: 'A rich, creamy Roman pasta with guanciale and pecorino.',
			servings: 4,
			prepTime: 10,
			cookTime: 15,
			suggestedTags: ['Dinner'],
		})
	})

	it('filters out already-assigned tags', () => {
		const text = JSON.stringify({
			description: null,
			servings: 4,
			prepTime: 10,
			cookTime: 15,
			suggestedTags: ['Italian', 'Dinner'],
		})
		const result = parseEnhanceResponse(text, ['Italian'])
		expect(result?.suggestedTags).toEqual(['Dinner'])
	})

	it('filters out invalid tag names', () => {
		const text = JSON.stringify({
			description: null,
			servings: 4,
			prepTime: null,
			cookTime: null,
			suggestedTags: ['Italian', 'Comfort Food', 'Quick'],
		})
		const result = parseEnhanceResponse(text, [])
		expect(result?.suggestedTags).toEqual(['Italian'])
	})

	it('normalizes tag name casing', () => {
		const text = JSON.stringify({
			description: null,
			servings: null,
			prepTime: null,
			cookTime: null,
			suggestedTags: ['italian', 'DINNER', 'gluten-free'],
		})
		const result = parseEnhanceResponse(text, [])
		expect(result?.suggestedTags).toEqual([
			'Italian',
			'Dinner',
			'Gluten-Free',
		])
	})

	it('returns null for empty/non-JSON text', () => {
		expect(parseEnhanceResponse('not json', [])).toBeNull()
		expect(parseEnhanceResponse('', [])).toBeNull()
	})

	it('handles markdown code block wrapping', () => {
		const text = '```json\n{"description": "A test recipe.", "servings": 2, "prepTime": 5, "cookTime": 10, "suggestedTags": []}\n```'
		const result = parseEnhanceResponse(text, [])
		expect(result?.description).toBe('A test recipe.')
		expect(result?.servings).toBe(2)
	})

	it('returns null for invalid field types gracefully', () => {
		const text = JSON.stringify({
			description: 123,
			servings: 'four',
			prepTime: -5,
			cookTime: 'twenty',
			suggestedTags: 'not an array',
		})
		const result = parseEnhanceResponse(text, [])
		expect(result).toEqual({
			description: null,
			servings: null,
			prepTime: null,
			cookTime: null,
			suggestedTags: [],
		})
	})

	it('clamps servings to 100', () => {
		const text = JSON.stringify({
			description: null,
			servings: 200,
			prepTime: null,
			cookTime: null,
			suggestedTags: [],
		})
		const result = parseEnhanceResponse(text, [])
		expect(result?.servings).toBeNull()
	})

	it('rounds fractional servings', () => {
		const text = JSON.stringify({
			description: null,
			servings: 4.5,
			prepTime: null,
			cookTime: null,
			suggestedTags: [],
		})
		const result = parseEnhanceResponse(text, [])
		expect(result?.servings).toBe(5)
	})

	it('treats null description as null', () => {
		const text = JSON.stringify({
			description: null,
			servings: 4,
			prepTime: 10,
			cookTime: 20,
			suggestedTags: [],
		})
		const result = parseEnhanceResponse(text, [])
		expect(result?.description).toBeNull()
	})

	it('trims whitespace in description', () => {
		const text = JSON.stringify({
			description: '  A tasty dish.  ',
			servings: null,
			prepTime: null,
			cookTime: null,
			suggestedTags: [],
		})
		const result = parseEnhanceResponse(text, [])
		expect(result?.description).toBe('A tasty dish.')
	})
})
