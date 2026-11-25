import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { LibrarySwitch } from '#app/components/library-switch.tsx'
import { MenuCard } from '#app/components/menu-card.tsx'
import { RecipeCardGrid } from '#app/components/recipe-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	TitleAddButton,
	TitleRow,
} from '#app/components/ui/title-add-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/index.ts'
import { PushLink } from '#app/components/push-link.tsx'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Menus | Quartermaster' }]
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
			sections: {
				orderBy: { order: 'asc' },
				select: {
					items: {
						orderBy: { order: 'asc' },
						where: { kind: 'recipe' },
						select: {
							recipe: {
								select: {
									title: true,
									householdId: true,
								},
							},
						},
					},
				},
			},
		},
		orderBy: { updatedAt: 'desc' },
	})

	// The list carries no Menu imagery; each row names its Recipes in Menu
	// order instead. Dangling references are skipped.
	return {
		menus: menus.map(({ sections, ...menu }) => {
			const recipes = sections.flatMap((section) =>
				section.items.flatMap((item) =>
					item.recipe && item.recipe.householdId === householdId
						? [{ title: item.recipe.title }]
						: [],
				),
			)
			return { ...menu, recipes }
		}),
	}
}

export default function MenusIndex({ loaderData }: Route.ComponentProps) {
	const { menus } = loaderData

	return (
		<div className="pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			{/* Page Header */}
			<div className="border-border/50 border-b">
				<TitleRow className="container-grid py-3 md:py-4">
					<h1 className="font-serif text-2xl font-normal">
						Menus{' '}
						<span className="text-muted-foreground text-base font-normal">
							({menus.length})
						</span>
					</h1>
					<TitleAddButton
						asChild
						aria-label="New Menu"
						className="sm:h-auto sm:w-auto sm:rounded-lg sm:px-4 sm:py-2"
					>
						<PushLink to="/recipes/menus/new">
							<span className="hidden sm:inline">New Menu</span>
						</PushLink>
					</TitleAddButton>
				</TitleRow>
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
								recipes={menu.recipes}
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
							<PushLink to="/recipes/menus/new">
								<Icon name="plus" size="sm" />
								New Menu
							</PushLink>
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
