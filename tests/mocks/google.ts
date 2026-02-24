import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { faker } from '@faker-js/faker'
import fsExtra from 'fs-extra'
import { HttpResponse, passthrough, http, type HttpHandler } from 'msw'

const { json } = HttpResponse

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const here = (...s: Array<string>) => path.join(__dirname, ...s)

const googleUserFixturePath = path.join(
	here(
		'..',
		'fixtures',
		'google',
		`users.${process.env.VITEST_POOL_ID || 0}.local.json`,
	),
)

await fsExtra.ensureDir(path.dirname(googleUserFixturePath))

function createGoogleUser(code?: string | null) {
	const primaryEmail = faker.internet.email()

	code ??= faker.string.uuid()
	return {
		code,
		accessToken: `${code}_mock_access_token`,
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

async function getGoogleUsers() {
	try {
		if (await fsExtra.pathExists(googleUserFixturePath)) {
			const json = await fsExtra.readJson(googleUserFixturePath)
			return json as Array<GoogleUser>
		}
		return []
	} catch (error) {
		console.error(error)
		return []
	}
}

export async function deleteGoogleUser(primaryEmail: string) {
	const users = await getGoogleUsers()
	const user = users.find((u) => u.primaryEmail === primaryEmail)
	if (!user) return null
	await setGoogleUsers(users.filter((u) => u.primaryEmail !== primaryEmail))
	return user
}

export async function deleteGoogleUsers() {
	await fsExtra.remove(googleUserFixturePath)
}

async function setGoogleUsers(users: Array<GoogleUser>) {
	await fsExtra.writeJson(googleUserFixturePath, users, { spaces: 2 })
}

export async function insertGoogleUser(code?: string | null) {
	const googleUsers = await getGoogleUsers()
	let user = googleUsers.find((u) => u.code === code)
	if (user) {
		Object.assign(user, createGoogleUser(code))
	} else {
		user = createGoogleUser(code)
		googleUsers.push(user)
	}
	await setGoogleUsers(googleUsers)
	return user
}

async function getUser(request: Request) {
	const accessToken = request.headers
		.get('authorization')
		?.slice('Bearer '.length)

	if (!accessToken) {
		return new Response('Unauthorized', { status: 401 })
	}
	const user = (await getGoogleUsers()).find(
		(u) => u.accessToken === accessToken,
	)

	if (!user) {
		return new Response('Not Found', { status: 404 })
	}
	return user
}

const passthroughGoogle =
	!process.env.GOOGLE_CLIENT_ID?.startsWith('MOCK_') &&
	process.env.NODE_ENV !== 'test'

export const handlers: Array<HttpHandler> = [
	http.post(
		'https://oauth2.googleapis.com/token',
		async ({ request }) => {
			if (passthroughGoogle) return passthrough()
			const params = new URLSearchParams(await request.text())

			const code = params.get('code')
			const googleUsers = await getGoogleUsers()
			let user = googleUsers.find((u) => u.code === code)
			if (!user) {
				user = await insertGoogleUser(code)
			}

			return json({
				access_token: user.accessToken,
				token_type: 'Bearer',
				expires_in: 3600,
				scope: 'openid email profile',
			})
		},
	),
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
