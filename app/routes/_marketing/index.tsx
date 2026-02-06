import { Link, redirect } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { type Route } from './+types/index.ts'

export const meta: Route.MetaFunction = () => [{ title: 'Quartermaster' }]

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	// Redirect logged-in users to recipes page
	if (userId) {
		throw redirect('/recipes')
	}
	return null
}

export default function Index() {
	return (
		<div className="font-poppins">
			{/* Hero Section */}
			<section className="grid place-items-center px-4 py-20 text-center md:py-28">
				<div className="max-w-2xl">
					<div className="animate-slide-top [animation-fill-mode:backwards]">
						<Icon name="cookie" className="text-foreground mx-auto size-16" />
					</div>

					<h1
						data-heading
						className="animate-slide-top text-foreground mt-6 text-4xl font-medium [animation-delay:0.2s] [animation-fill-mode:backwards] md:text-5xl xl:text-6xl"
					>
						Quartermaster
					</h1>

					<p
						data-paragraph
						className="animate-slide-top text-muted-foreground mx-auto mt-6 max-w-lg text-lg/7 [animation-delay:0.4s] [animation-fill-mode:backwards]"
					>
						Your personal recipe manager. Store recipes, track what's in your
						kitchen, plan meals, and never wonder what to cook again.
					</p>

					<div className="animate-slide-top mt-8 [animation-delay:0.6s] [animation-fill-mode:backwards]">
						<Button asChild size="lg">
							<Link to="/login">Get Started</Link>
						</Button>
					</div>
				</div>
			</section>

			{/* Features Section */}
			<section className="animate-slide-top px-4 pb-16 [animation-delay:0.8s] [animation-fill-mode:backwards]">
				<h2 className="mb-6 text-center text-2xl font-semibold">
					Key Features
				</h2>
				<div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
					<div className="bg-muted/50 rounded-xl p-6">
						<Icon name="file-text" className="text-primary size-8" />
						<h3 className="mt-3 text-lg font-semibold">Recipe Collection</h3>
						<p className="text-muted-foreground mt-1 text-sm">
							Import from URLs, paste text, or build from scratch. Search and
							filter your full library.
						</p>
					</div>
					<div className="bg-muted/50 rounded-xl p-6">
						<Icon name="home" className="text-primary size-8" />
						<h3 className="mt-3 text-lg font-semibold">Kitchen Inventory</h3>
						<p className="text-muted-foreground mt-1 text-sm">
							Track what's in your pantry, fridge, and freezer. Know what you
							have at a glance.
						</p>
					</div>
					<div className="bg-muted/50 rounded-xl p-6">
						<Icon name="magnifying-glass" className="text-primary size-8" />
						<h3 className="mt-3 text-lg font-semibold">Discover Recipes</h3>
						<p className="text-muted-foreground mt-1 text-sm">
							Find recipes you can make right now based on ingredients you
							already have.
						</p>
					</div>
					<div className="bg-muted/50 rounded-xl p-6">
						<Icon name="clock" className="text-primary size-8" />
						<h3 className="mt-3 text-lg font-semibold">Meal Planning</h3>
						<p className="text-muted-foreground mt-1 text-sm">
							Plan your week, generate shopping lists, and never overbuy at the
							store.
						</p>
					</div>
				</div>
			</section>

			{/* How It Works */}
			<section className="animate-slide-top px-4 pb-16 [animation-delay:1s] [animation-fill-mode:backwards]">
				<div className="mx-auto max-w-2xl">
					<h2 className="text-center text-2xl font-semibold">How It Works</h2>
					<div className="mt-8 space-y-6">
						<div className="flex gap-4">
							<div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">
								1
							</div>
							<div>
								<h3 className="font-semibold">Add your recipes</h3>
								<p className="text-muted-foreground text-sm">
									Import from your favorite cooking websites or type them in
									directly.
								</p>
							</div>
						</div>
						<div className="flex gap-4">
							<div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">
								2
							</div>
							<div>
								<h3 className="font-semibold">Track your ingredients</h3>
								<p className="text-muted-foreground text-sm">
									Mark what's in your kitchen so you always know what you have
									on hand.
								</p>
							</div>
						</div>
						<div className="flex gap-4">
							<div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">
								3
							</div>
							<div>
								<h3 className="font-semibold">Cook with confidence</h3>
								<p className="text-muted-foreground text-sm">
									Discover what you can make, plan your week, and generate
									shopping lists automatically.
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Final CTA */}
			<section className="animate-slide-top px-4 pb-20 text-center [animation-delay:1.2s] [animation-fill-mode:backwards]">
				<h2 className="text-xl font-semibold">Ready to get organized?</h2>
				<div className="mt-4">
					<Button asChild size="lg">
						<Link to="/login">Get Started</Link>
					</Button>
				</div>
			</section>
		</div>
	)
}
