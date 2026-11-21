import { redirect } from 'react-router'
import { logout } from '#app/utils/auth.server.ts'
import { type Route } from './+types/logout.ts'

export async function loader() {
	return redirect('/')
}

export async function action({ request }: Route.ActionArgs) {
	// The verify page logs out and comes back to the same code.
	const formData = await request.formData().catch(() => null)
	const redirectTo = formData?.get('redirectTo')
	return logout({
		request,
		redirectTo: typeof redirectTo === 'string' ? redirectTo : undefined,
	})
}
