import { redirect } from 'react-router'
import { getBrowserSession, logout } from '#app/utils/auth.server.ts'
import { endDemoUser } from '#app/utils/demo.server.ts'
import { type Route } from './+types/logout.ts'

export async function loader() {
	return redirect('/')
}

export async function action({ request }: Route.ActionArgs) {
	// The verify page logs out and comes back to the same code.
	const formData = await request.formData().catch(() => null)
	const redirectTo = formData?.get('redirectTo')
	// A demo user goes at once, which frees its live slot. Whatever fails
	// here, the cookies still go below.
	try {
		const userId = (await getBrowserSession(request))?.userId
		if (userId) await endDemoUser(userId)
	} catch (error) {
		console.error(
			`Log Out: couldn't check for a demo user to delete: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
	return logout({
		request,
		redirectTo: typeof redirectTo === 'string' ? redirectTo : undefined,
	})
}
