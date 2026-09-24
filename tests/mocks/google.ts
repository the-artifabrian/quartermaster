import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { faker } from '@faker-js/faker'
import { HttpResponse, passthrough, http, type HttpHandler } from 'msw'

const { json } = HttpResponse

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const here = (...s: Array<string>) => path.join(__dirname, ...s)

// One file per user: parallel Playwright workers insert and delete users while
// the app server reads them, and a shared file would lose concurrent writes.
const googleUsersDirectory = here(
	'..',
	'fixtures',
	'google',
	`users.${process.env.VITEST_POOL_ID || 0}.local.d`,
)

const ACCESS_TOKEN_SUFFIX = '_mock_access_token'

function googleUserPath(code: string) {
	return path.join(googleUsersDirectory, `${encodeURIComponent(code)}.json`)
}

function createGoogleUser(code?: string | null) {
	// Onboarding suggests the email's local part as the username, so keep it
	// short enough to pass username validation.
	const primaryEmail = faker.internet.email({
		firstName: faker.string.alpha(6),
		lastName: faker.string.alpha(6),
	})

	code ??= faker.string.uuid()
	return {
		code,
		accessToken: `${code}${ACCESS_TOKEN_SUFFIX}`,
		profile: {
			id: faker.string.uuid(),
			email: primaryEmail,
			name: faker.person.fullName(),
			picture: 'https://lh3.googleusercontent.com/a/default-user',
		},
		primaryEmail,
	}
}

export type GoogleUser = ReturnType<typeof createGoogleUser>

async function getGoogleUser(code: string) {
	try {
		const raw = await fs.readFile(googleUserPath(code), 'utf8')
		return JSON.parse(raw) as GoogleUser
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(error)
		return null
	}
}

export async function deleteGoogleUser(code: string) {
	await fs.rm(googleUserPath(code), { force: true })
}

export async function deleteGoogleUsers() {
	await fs.rm(googleUsersDirectory, { recursive: true, force: true })
}

export async function insertGoogleUser(code?: string | null) {
	const user = createGoogleUser(code)
	await fs.mkdir(googleUsersDirectory, { recursive: true })
	await fs.writeFile(googleUserPath(user.code), JSON.stringify(user, null, 2))
	return user
}

async function getUser(request: Request) {
	const accessToken = request.headers
		.get('authorization')
		?.slice('Bearer '.length)

	if (!accessToken) {
		return new Response('Unauthorized', { status: 401 })
	}
	const user = accessToken.endsWith(ACCESS_TOKEN_SUFFIX)
		? await getGoogleUser(accessToken.slice(0, -ACCESS_TOKEN_SUFFIX.length))
		: null

	if (!user) {
		return new Response('Not Found', { status: 404 })
	}
	return user
}

const passthroughGoogle =
	!process.env.GOOGLE_CLIENT_ID?.startsWith('MOCK_') &&
	process.env.NODE_ENV !== 'test'

export const handlers: Array<HttpHandler> = [
	http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
		if (passthroughGoogle) return passthrough()
		const params = new URLSearchParams(await request.text())

		const code = params.get('code')
		const user =
			(code ? await getGoogleUser(code) : null) ??
			(await insertGoogleUser(code))

		return json({
			access_token: user.accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			scope: 'openid email profile',
		})
	}),
	http.get(
		'https://www.googleapis.com/oauth2/v2/userinfo',
		async ({ request }) => {
			if (passthroughGoogle) return passthrough()

			const user = await getUser(request)
			if (user instanceof Response) return user

			return json({
				id: user.profile.id,
				email: user.profile.email,
				name: user.profile.name,
				picture: user.profile.picture,
			})
		},
	),
]
