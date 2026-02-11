import { z } from 'zod'

export const SaveTemplateSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, { message: 'Template name is required' })
		.max(100, { message: 'Template name must be 100 characters or less' }),
	weekStart: z.string().min(1, { message: 'Week start is required' }),
})

export const ApplyTemplateSchema = z.object({
	templateId: z.string().min(1, { message: 'Template is required' }),
	weekStart: z.string().min(1, { message: 'Week start is required' }),
})

export const DeleteTemplateSchema = z.object({
	templateId: z.string().min(1, { message: 'Template is required' }),
})
