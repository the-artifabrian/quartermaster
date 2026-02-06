import { type Route } from './+types/privacy.ts'

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Privacy Policy | Quartermaster' }]
}

export default function PrivacyRoute() {
	return <div>Privacy</div>
}
