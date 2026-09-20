import { Outlet } from 'react-router'
import { MarketingFooter } from '#app/components/marketing-footer.tsx'

export default function MarketingLayout() {
	return (
		<>
			<Outlet />
			<MarketingFooter />
		</>
	)
}
