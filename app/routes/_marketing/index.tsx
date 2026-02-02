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
		<main className="font-poppins grid h-full place-items-center">
			<div className="grid place-items-center px-4 py-16 max-w-2xl text-center">
				<div className="animate-slide-top [animation-fill-mode:backwards]">
					<Icon name="cookie" className="text-foreground size-20" />
				</div>

				<h1
					data-heading
					className="animate-slide-top text-foreground mt-8 text-4xl font-medium [animation-delay:0.3s] [animation-fill-mode:backwards] md:text-5xl xl:text-6xl"
				>
					Quartermaster
				</h1>

				<p
					data-paragraph
					className="animate-slide-top text-muted-foreground mt-6 text-xl/7 [animation-delay:0.5s] [animation-fill-mode:backwards]"
				>
					Your personal recipe manager. Organize your recipes, track your
					ingredients, and plan your meals.
				</p>

				<div className="animate-slide-top mt-10 flex flex-wrap justify-center gap-4 [animation-delay:0.7s] [animation-fill-mode:backwards]">
					<Button asChild size="lg">
						<Link to="/login">Get Started</Link>
					</Button>
				</div>

				<ul className="animate-slide-top mt-16 grid gap-4 text-left text-muted-foreground [animation-delay:0.9s] [animation-fill-mode:backwards] sm:grid-cols-2">
					<li className="flex items-start gap-3">
						<Icon name="check" className="size-5 text-primary mt-0.5" />
						<span>Store and organize 100+ recipes</span>
					</li>
					<li className="flex items-start gap-3">
						<Icon name="check" className="size-5 text-primary mt-0.5" />
						<span>Search by name or ingredients</span>
					</li>
					<li className="flex items-start gap-3">
						<Icon name="check" className="size-5 text-primary mt-0.5" />
						<span>Track pantry, fridge & freezer</span>
					</li>
					<li className="flex items-start gap-3">
						<Icon name="check" className="size-5 text-primary mt-0.5" />
						<span>Plan weekly meals</span>
					</li>
				</ul>
			</div>
		</main>
	)
}
