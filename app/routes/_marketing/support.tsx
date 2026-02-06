import { type Route } from './+types/support.ts'

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Support | Quartermaster' }]
}

export default function SupportRoute() {
	return <div>Support</div>
}
