import { redirect } from 'react-router'
import { type Route } from './+types/index.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const params = new URLSearchParams(url.searchParams)
	params.delete('sort')
	const qs = params.toString()
	return redirect(`/recipes${qs ? '?' + qs : ''}`)
}

export async function action({ request }: Route.ActionArgs) {
	const url = new URL(request.url)
	const params = new URLSearchParams(url.searchParams)
	params.delete('sort')
	const qs = params.toString()
	return redirect(`/recipes${qs ? '?' + qs : ''}`)
}
