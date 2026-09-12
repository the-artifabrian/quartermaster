import { prisma } from '#app/utils/db.server.ts'
import {
	readShoppingCheck,
	writeShoppingCheck,
} from '#app/utils/shopping-check.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/shopping-check.ts'

const headers = { 'Cache-Control': 'private, no-store' }

// Plain JSON keeps a transport failure local to the checkbox. React Router's
// fetcher transport otherwise sends network exceptions to the route boundary.
async function respond(request: Request, write: boolean) {
	try {
		const identity = await requireUserWithTier(request)
		if (write) {
			const result = await writeShoppingCheck(
				prisma,
				identity,
				await request.formData(),
			)
			const status =
				result.status === 'success'
					? 200
					: result.status === 'conflict'
						? 409
						: result.status === 'missing'
							? 404
							: 400
			return Response.json(result, { status, headers })
		}
		const id = new URL(request.url).searchParams.get('itemId') ?? ''
		const item = await readShoppingCheck(prisma, identity.householdId, id)
		return Response.json(
			item ? { status: 'success', item } : { status: 'missing' },
			{
				status: item ? 200 : 404,
				headers,
			},
		)
	} catch (error) {
		if (error instanceof Response && error.status < 500) {
			return Response.json(
				{ status: 'denied' },
				{
					status:
						error.status >= 300 && error.status < 400 ? 401 : error.status,
					headers,
				},
			)
		}
		throw error
	}
}

export const loader = ({ request }: Route.LoaderArgs) => respond(request, false)
export const action = ({ request }: Route.ActionArgs) => respond(request, true)
