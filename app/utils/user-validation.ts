import { z } from 'zod'

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

export const UsernameSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Enter a username' : undefined,
	})
	.min(USERNAME_MIN_LENGTH, {
		error: `Use at least ${USERNAME_MIN_LENGTH} characters`,
	})
	.max(USERNAME_MAX_LENGTH, {
		error: `Use ${USERNAME_MAX_LENGTH} characters or fewer`,
	})
	.regex(/^[a-zA-Z0-9_]+$/, {
		error: 'Use only letters, numbers and underscores',
	})
	// users can type the username in any case, but we store it in lowercase
	.transform((value) => value.toLowerCase())

export const PasswordSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Enter a password' : undefined,
	})
	.min(6, { error: 'Use at least 6 characters' })
	// bcrypt reads only the first 72 bytes.
	// https://github.com/epicweb-dev/epic-stack/issues/918
	.refine((val) => new TextEncoder().encode(val).length <= 72, {
		error: 'Use a shorter password',
	})

export const NameSchema = z
	.string({
		error: (issue) => (issue.input === undefined ? 'Enter a name' : undefined),
	})
	.min(3, { error: 'Use at least 3 characters' })
	.max(40, { error: 'Use 40 characters or fewer' })

export const EmailSchema = z
	.email({
		error: (issue) =>
			issue.input === undefined
				? 'Enter an email address'
				: 'Enter a valid email address',
	})
	.min(3, { error: 'Enter a valid email address' })
	.max(100, { error: 'Use an email address of 100 characters or fewer' })
	// users can type the email in any case, but we store it in lowercase
	.transform((value) => value.toLowerCase())

export const PasswordAndConfirmPasswordSchema = z
	.object({ password: PasswordSchema, confirmPassword: PasswordSchema })
	.superRefine(({ confirmPassword, password }, ctx) => {
		if (confirmPassword !== password) {
			ctx.addIssue({
				path: ['confirmPassword'],
				code: 'custom',
				message: 'Enter the same password twice',
			})
		}
	})
