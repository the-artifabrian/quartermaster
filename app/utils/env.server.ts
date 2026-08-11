import { z } from 'zod'

// Optional vars are conventionally present-but-empty in .env files, so treat
// '' the same as unset before validating.
const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value)

const schema = z.object({
	NODE_ENV: z.enum(['production', 'development', 'test'] as const),
	DATABASE_PATH: z.string(),
	DATABASE_URL: z.string(),
	DATA_VOLUME_PATH: z.string().optional(),
	SESSION_SECRET: z.string(),
	INTERNAL_COMMAND_TOKEN: z.string(),
	CACHE_DATABASE_PATH: z.string(),
	// Everything that reads this compares === 'true' (index.ts,
	// resources/images.tsx, the production guard below). Validating it here
	// keeps a typo like MOCKS=fasle from silently meaning anything at all.
	MOCKS: z.preprocess(emptyAsUndefined, z.enum(['true', 'false']).optional()),
	POSTHOG_API_KEY: z.string().optional(),
	POSTHOG_HOST: z.url().optional(),
	// Optional outside production; the refinement below requires it in
	// production, where a missing key means silently undelivered mail rather
	// than an error.
	RESEND_API_KEY: z.string().optional(),
	// Override for the email provider request timeout, in whole ms (default
	// 10000). A malformed value must fail the boot here — at send time it would
	// become Number('10s') === NaN or Number('') === 0, and a 0ms timeout
	// aborts every email before the request leaves the process.
	RESEND_TIMEOUT_MS: z.preprocess(
		emptyAsUndefined,
		z
			.string()
			.regex(/^[1-9]\d*$/, 'must be a positive whole number of milliseconds')
			.optional(),
	),
	// If you plan to use Google auth, remove the .optional()
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GOOGLE_REDIRECT_URI: z.string().optional(),

	ALLOW_INDEXING: z.enum(['true', 'false']).optional(),

	// Anthropic API (optional — used for AI recipe features)
	ANTHROPIC_API_KEY: z.string().optional(),

	// Groq API (optional — used for Whisper speech-to-text)
	GROQ_API_KEY: z.string().optional(),

	// Stripe (all optional — subscription features only active when configured)
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_PRO_YEARLY_PRICE_ID: z.string().optional(),

	// Tigris Object Storage Configuration
	AWS_ACCESS_KEY_ID: z.string(),
	AWS_SECRET_ACCESS_KEY: z.string(),
	AWS_REGION: z.string(),
	AWS_ENDPOINT_URL_S3: z.url(),
	BUCKET_NAME: z.string(),
})

// Outside production a missing RESEND_API_KEY only makes sendEmail log the
// message instead of sending it, which is useful in dev. In production that
// silence is the failure: signup verification, password reset and email-change
// mail all stop arriving while every request still succeeds and the
// healthcheck stays green, so users lock themselves out and nothing reports
// it. A dropped or rotated secret should fail validation instead — expressed
// on the schema so it reports through the same aggregated error path as every
// other field, alongside anything else that's missing.
const validatedSchema = schema.superRefine((env, ctx) => {
	if (
		env.NODE_ENV === 'production' &&
		env.MOCKS !== 'true' &&
		!env.RESEND_API_KEY
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['RESEND_API_KEY'],
			message:
				'required in production — without it every verification, password-reset and email-change email is dropped silently',
		})
	}
})

declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof schema> {}
	}
}

export function init() {
	const parsed = validatedSchema.safeParse(process.env)

	if (parsed.success === false) {
		console.error(
			'❌ Invalid environment variables:',
			z.flattenError(parsed.error).fieldErrors,
		)

		throw new Error('Invalid environment variables')
	}
}

/**
 * This is used in both `entry.server.ts` and `root.tsx` to ensure that
 * the environment variables are set and globally available before the app is
 * started.
 *
 * NOTE: Do *not* add any environment variables in here that you do not wish to
 * be included in the client.
 * @returns all public ENV variables
 */
export function getEnv() {
	return {
		MODE: process.env.NODE_ENV,
		POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
		POSTHOG_HOST: process.env.POSTHOG_HOST,
		ALLOW_INDEXING: process.env.ALLOW_INDEXING,
	}
}

type ENV = ReturnType<typeof getEnv>

declare global {
	var ENV: ENV
	interface Window {
		ENV: ENV
	}
}
