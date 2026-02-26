import { Link, Outlet } from 'react-router'

export default function MarketingLayout() {
	return (
		<>
			<Outlet />
			<footer className="border-border border-t">
				<div className="container-landing py-8 text-center">
					<nav className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
						<Link to="/about" className="hover:text-foreground">
							About
						</Link>
						<Link to="/support" className="hover:text-foreground">
							Support
						</Link>
						<Link to="/privacy" className="hover:text-foreground">
							Privacy
						</Link>
						<Link to="/tos" className="hover:text-foreground">
							Terms
						</Link>
					</nav>
				</div>
			</footer>
		</>
	)
}
