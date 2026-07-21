import { z } from 'zod'

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

export const UsernameSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Username is required' : undefined,
	})
	.min(USERNAME_MIN_LENGTH, { error: 'Username is too short' })
	.max(USERNAME_MAX_LENGTH, { error: 'Username is too long' })
	.regex(/^[a-zA-Z0-9_]+$/, {
		error: 'Username can only include letters, numbers, and underscores',
	})
	// users can type the username in any case, but we store it in lowercase
	.transform((value) => value.toLowerCase())

export const PasswordSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Password is required' : undefined,
	})
	.min(6, { error: 'Password is too short' })
	// NOTE: bcrypt has a limit of 72 bytes (which should be plenty long)
	// https://github.com/epicweb-dev/epic-stack/issues/918
	.refine((val) => new TextEncoder().encode(val).length <= 72, {
		error: 'Password is too long',
	})

export const NameSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Name is required' : undefined,
	})
	.min(3, { error: 'Name is too short' })
	.max(40, { error: 'Name is too long' })

export const EmailSchema = z
	.email({
		error: (issue) =>
			issue.input === undefined ? 'Email is required' : 'Email is invalid',
	})
	.min(3, { error: 'Email is too short' })
	.max(100, { error: 'Email is too long' })
	// users can type the email in any case, but we store it in lowercase
	.transform((value) => value.toLowerCase())

export const PasswordAndConfirmPasswordSchema = z
	.object({ password: PasswordSchema, confirmPassword: PasswordSchema })
	.superRefine(({ confirmPassword, password }, ctx) => {
		if (confirmPassword !== password) {
			ctx.addIssue({
				path: ['confirmPassword'],
				code: 'custom',
				message: 'The passwords must match',
			})
		}
	})
