import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { LibrarySwitch } from '#app/components/library-switch.tsx'
import { MenuCard } from '#app/components/menu-card.tsx'
import { RecipeCardGrid } from '#app/components/recipe-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'My Menus | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)

	const menus = await prisma.menu.findMany({
		where: { householdId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
		},
		orderBy: { updatedAt: 'desc' },
	})

	return { menus }
}

export default function MenusIndex({ loaderData }: Route.ComponentProps) {
	const { menus } = loaderData

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="border-border/50 border-b">
				<div className="container-grid flex items-center justify-between gap-3 py-3 md:py-4">
					<h1 className="font-serif text-2xl font-normal">
						My Menus{' '}
						<span className="text-muted-foreground text-base font-normal">
							({menus.length})
						</span>
					</h1>
					<Button
						asChild
						className="size-10 rounded-full p-0 sm:h-auto sm:w-auto sm:rounded-lg sm:px-4 sm:py-2"
					>
						<Link to="/recipes/menus/new">
							<Icon name="plus" size="sm" />
							<span className="hidden sm:inline">New Menu</span>
						</Link>
					</Button>
				</div>
			</div>

			<div className="container-grid py-4">
				<LibrarySwitch active="menus" />

				{menus.length > 0 ? (
					<RecipeCardGrid>
						{menus.map((menu) => (
							<MenuCard
								key={menu.id}
								id={menu.id}
								title={menu.title}
								description={menu.description}
								defaultGuestCount={menu.defaultGuestCount}
							/>
						))}
					</RecipeCardGrid>
				) : (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="border-border flex size-20 items-center justify-center rounded-full border-2 border-dashed">
							<Icon name="rows" className="text-muted-foreground/40 size-8" />
						</div>
						<h2 className="mt-4 font-serif text-xl font-normal">
							No Menus yet
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Create a Menu for Recipes and notes you serve together.
						</p>
						<Button asChild className="mt-6">
							<Link to="/recipes/menus/new">
								<Icon name="plus" size="sm" />
								New Menu
							</Link>
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
