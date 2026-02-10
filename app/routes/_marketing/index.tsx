import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link, redirect } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: '', priority: 1.0 }],
}

export const meta: Route.MetaFunction = () => [{ title: 'Quartermaster' }]

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	// Redirect logged-in users to recipes page
	if (userId) {
		throw redirect('/recipes')
	}
	return data(null, {
		headers: { 'Cache-Control': 'public, max-age=300' },
	})
}

export const headers: Route.HeadersFunction = pipeHeaders

export default function Index() {
	return (
		<div>
			{/* Hero Section */}
			<section className="relative overflow-hidden px-4 py-20 text-center">
				{/* Background pattern */}
				<div className="from-accent/5 via-primary/3 to-background absolute inset-0 bg-linear-to-b" />
				<div className="relative mx-auto max-w-3xl">
					<div className="animate-slide-top fill-mode-[backwards]">
						<Icon name="cookie" className="text-accent mx-auto size-14" />
					</div>

					<h1
						data-heading
						className="animate-slide-top text-foreground fill-mode-[backwards] mt-6 font-serif text-5xl font-bold tracking-tight [animation-delay:0.2s] md:text-7xl"
					>
						Your recipes.
						<br />
						Your kitchen.
						<br />
						<span className="text-accent">One place.</span>
					</h1>

					<p
						data-paragraph
						className="animate-slide-top text-muted-foreground fill-mode-[backwards] mx-auto mt-8 max-w-lg text-lg/7 [animation-delay:0.4s]"
					>
						Stop wondering what to cook. Quartermaster connects your recipes to
						what's actually in your kitchen, plans your week, and writes your
						shopping list.
					</p>

					<div className="animate-slide-top fill-mode-[backwards] mt-10 flex flex-col items-center gap-4 [animation-delay:0.6s] sm:flex-row sm:justify-center">
						<Button
							asChild
							size="lg"
							className="shadow-warm-md rounded-full px-8"
						>
							<Link to="/signup">
								Start Cooking — It's Free
								<Icon name="arrow-right" size="sm" />
							</Link>
						</Button>
						<Button asChild variant="ghost" size="lg" className="rounded-full">
							<a href="#features">
								See how it works
								<Icon name="chevron-down" size="sm" />
							</a>
						</Button>
					</div>
				</div>
			</section>

			{/* Feature Story Section */}
			<section
				id="features"
				className="animate-slide-top fill-mode-[backwards] px-4 pb-20 [animation-delay:0.8s]"
			>
				<div className="mx-auto max-w-4xl space-y-16 md:space-y-24">
					{/* Feature 1 — left visual */}
					<div className="flex flex-col items-center gap-8 md:flex-row">
						<div className="bg-card shadow-warm flex-1 rounded-2xl border p-6">
							<div className="flex items-center gap-3">
								<div className="bg-accent/10 flex size-10 items-center justify-center rounded-xl">
									<Icon name="file-text" className="text-accent size-5" />
								</div>
								<div>
									<p className="text-sm font-semibold">Chicken Tikka Masala</p>
									<p className="text-muted-foreground text-xs">
										45 min · 4 servings
									</p>
								</div>
							</div>
							<div className="mt-4 space-y-1.5">
								{[
									'Chicken thighs',
									'Yogurt',
									'Garam masala',
									'Tomato sauce',
								].map((ing) => (
									<div
										key={ing}
										className="bg-muted/50 rounded-md px-3 py-1.5 text-sm"
									>
										{ing}
									</div>
								))}
							</div>
						</div>
						<div className="flex-1 text-center md:text-left">
							<p className="text-accent mb-2 font-serif text-sm font-medium">
								Step 1
							</p>
							<h3 className="text-2xl font-bold">
								Import your favorite recipes
							</h3>
							<p className="text-muted-foreground mt-2">
								Paste a URL, type it in, or use quick entry for that recipe
								scribbled on a napkin. Your whole collection in one searchable
								place.
							</p>
						</div>
					</div>

					{/* Feature 2 — right visual */}
					<div className="flex flex-col items-center gap-8 md:flex-row-reverse">
						<div className="bg-card shadow-warm flex-1 rounded-2xl border p-6">
							<div className="mb-3 flex items-center gap-2">
								<span className="inline-block size-2.5 rounded-full bg-amber-500" />
								<span className="text-sm font-semibold">Pantry</span>
								<span className="text-muted-foreground text-xs">12 items</span>
							</div>
							<div className="flex flex-wrap gap-2">
								{[
									'Rice',
									'Olive oil',
									'Garlic',
									'Onions',
									'Soy sauce',
									'Flour',
								].map((item) => (
									<span
										key={item}
										className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
									>
										{item}
									</span>
								))}
							</div>
							<div className="mt-3 flex items-center gap-2">
								<span className="inline-block size-2.5 rounded-full bg-blue-500" />
								<span className="text-sm font-semibold">Fridge</span>
								<span className="text-muted-foreground text-xs">8 items</span>
							</div>
							<div className="mt-2 flex flex-wrap gap-2">
								{['Chicken', 'Eggs', 'Butter', 'Milk'].map((item) => (
									<span
										key={item}
										className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
									>
										{item}
									</span>
								))}
							</div>
						</div>
						<div className="flex-1 text-center md:text-right">
							<p className="text-accent mb-2 font-serif text-sm font-medium">
								Step 2
							</p>
							<h3 className="text-2xl font-bold">
								Track what's in your kitchen
							</h3>
							<p className="text-muted-foreground mt-2">
								Pantry, fridge, freezer — know what you have at a glance. Get
								alerts when things are expiring so nothing goes to waste.
							</p>
						</div>
					</div>

					{/* Feature 3 — left visual */}
					<div className="flex flex-col items-center gap-8 md:flex-row">
						<div className="bg-card shadow-warm flex-1 rounded-2xl border p-6">
							<div className="grid grid-cols-4 gap-2 text-center text-xs">
								{['Mon', 'Tue', 'Wed', 'Thu'].map((day) => (
									<div key={day}>
										<p className="text-muted-foreground mb-1 font-medium">
											{day}
										</p>
										<div className="bg-accent/10 rounded-lg p-2">
											<p className="truncate text-[10px] font-medium">
												{day === 'Mon'
													? 'Pasta'
													: day === 'Tue'
														? 'Stir Fry'
														: day === 'Wed'
															? 'Tacos'
															: 'Soup'}
											</p>
										</div>
									</div>
								))}
							</div>
							<div className="mt-3 flex items-center justify-center gap-2">
								<span className="bg-accent inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">
									67% overlap
								</span>
								<span className="text-muted-foreground text-[10px]">
									3 shared ingredients
								</span>
							</div>
						</div>
						<div className="flex-1 text-center md:text-left">
							<p className="text-accent mb-2 font-serif text-sm font-medium">
								Step 3
							</p>
							<h3 className="text-2xl font-bold">
								Plan meals that share ingredients
							</h3>
							<p className="text-muted-foreground mt-2">
								Drag recipes into your weekly plan. Quartermaster spots
								ingredient overlaps so you buy less and waste less.
							</p>
						</div>
					</div>

					{/* Feature 4 — right visual */}
					<div className="flex flex-col items-center gap-8 md:flex-row-reverse">
						<div className="bg-card shadow-warm flex-1 rounded-2xl border p-6">
							<div className="space-y-2">
								{[
									{ name: 'Chicken thighs', checked: true },
									{ name: 'Yogurt', checked: true },
									{ name: 'Tortillas', checked: false },
									{ name: 'Avocados', checked: false },
									{ name: 'Lime', checked: false },
								].map((item) => (
									<div
										key={item.name}
										className="flex items-center gap-2 text-sm"
									>
										<div
											className={`flex size-4 items-center justify-center rounded border-2 ${item.checked ? 'border-primary bg-primary' : 'border-input'}`}
										>
											{item.checked && (
												<Icon
													name="check"
													size="xs"
													className="text-primary-foreground"
												/>
											)}
										</div>
										<span
											className={
												item.checked ? 'text-muted-foreground line-through' : ''
											}
										>
											{item.name}
										</span>
									</div>
								))}
							</div>
							<div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
								<div className="bg-accent h-full w-2/5 rounded-full" />
							</div>
						</div>
						<div className="flex-1 text-center md:text-right">
							<p className="text-accent mb-2 font-serif text-sm font-medium">
								Step 4
							</p>
							<h3 className="text-2xl font-bold">
								Generate a smart shopping list
							</h3>
							<p className="text-muted-foreground mt-2">
								One tap generates a shopping list from your meal plan, minus
								what you already have. Check items off as you shop.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Final CTA */}
			<section className="px-4 pb-20 text-center">
				<div className="from-primary/5 to-accent/5 mx-auto max-w-xl rounded-3xl bg-linear-to-r p-12">
					<h2 className="font-serif text-2xl font-bold">
						Ready to get organized?
					</h2>
					<p className="text-muted-foreground mt-2">
						Free to use. No credit card required.
					</p>
					<div className="mt-6">
						<Button
							asChild
							size="lg"
							className="shadow-warm-md rounded-full px-8"
						>
							<Link to="/signup">
								Start Cooking — It's Free
								<Icon name="arrow-right" size="sm" />
							</Link>
						</Button>
					</div>
				</div>
			</section>
		</div>
	)
}
