import { type Route } from './+types/tos.ts'

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Terms of Service | Quartermaster' }]
}

export default function TermsOfServiceRoute() {
	return <div>Terms of service</div>
}
