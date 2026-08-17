import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { MenuPlaceholder } from '#app/components/menu-card.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { sectionLabelClass } from '#app/utils/misc.tsx'
import { type Route } from './+types/$menuId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
	const title = loaderData?.menu?.title
		? `${loaderData.menu.title} | Quartermaster`
		: 'Menu | Quartermaster'
	return [{ title }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
			householdId: true,
			sections: {
				select: { id: true, name: true },
				orderBy: { order: 'asc' },
			},
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	return { menu }
}

export default function MenuDetail({ loaderData }: Route.ComponentProps) {
	const { menu } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<Link
				to="/recipes/menus"
				viewTransition
				className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition-colors"
			>
				<Icon name="arrow-left" size="sm" />
				Menus
			</Link>

			<MenuPlaceholder
				label={`${menu.title} menu`}
				className="mb-6 h-32 rounded-lg md:h-40"
				iconClassName="size-8 md:size-10"
			/>

			<div className="flex items-start justify-between gap-3">
				<h1 className="font-serif text-2xl font-normal">{menu.title}</h1>
				<Button asChild variant="outline">
					<Link to={`/recipes/menus/${menu.id}/edit`}>
						<Icon name="pencil-1" size="sm" />
						Edit
					</Link>
				</Button>
			</div>

			{menu.defaultGuestCount ? (
				<p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
					<Icon name="avatar" size="xs" />
					Usually for {menu.defaultGuestCount} guests
				</p>
			) : null}

			{menu.description && (
				<p className="text-muted-foreground mt-3 leading-relaxed">
					{menu.description}
				</p>
			)}

			<div className="mt-8 space-y-8">
				{menu.sections.map((section) => (
					<section key={section.id}>
						{/* The unnamed section stays headingless */}
						{section.name ? (
							<h2 className={sectionLabelClass}>{section.name}</h2>
						) : null}
						<p className="text-muted-foreground border-border/60 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm">
							Nothing on this menu yet.
						</p>
					</section>
				))}
			</div>
		</div>
	)
}
