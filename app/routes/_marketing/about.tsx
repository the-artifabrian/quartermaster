import { type Route } from './+types/about.ts'

export const meta: Route.MetaFunction = () => {
	return [{ title: 'About | Quartermaster' }]
}

export default function AboutRoute() {
	return <div>About page</div>
}
