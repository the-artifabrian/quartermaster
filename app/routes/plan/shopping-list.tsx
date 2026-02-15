import { redirect } from 'react-router'
import { type Route } from './+types/shopping-list.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	return redirect(`/shopping${url.search}`)
}

export async function action({ request }: Route.ActionArgs) {
	const url = new URL(request.url)
	return redirect(`/shopping${url.search}`)
}
