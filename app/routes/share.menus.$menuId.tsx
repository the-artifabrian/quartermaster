import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link, redirect, useFetcher } from 'react-router'
import { MenuContents } from '#app/components/menu-contents.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { findSavedMenu, saveSharedMenu } from '#app/utils/share-menu.server.ts'
import { type Route } from './+types/share.menus.$menuId.ts'

export const handle: SEOHandle = { getSitemapEntries: () => null }
export const meta: Route.MetaFunction = ({ loaderData }) => [
	{ title: `${loaderData?.menu.title ?? 'Menu'} | Quartermaster` },
	{
		name: 'description',
		content: loaderData?.menu.description || 'A shared Menu on Quartermaster',
	},
	{ property: 'og:title', content: loaderData?.menu.title ?? 'Menu' },
	{ property: 'og:type', content: 'article' },
]

export async function loader({ params, request }: Route.LoaderArgs) {
	const menu = await prisma.menu.findUnique({
		where: { id: params.menuId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
			householdId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							kind: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
							recipe: {
								select: {
									id: true,
									title: true,
									householdId: true,
									yieldAmount: true,
									yieldLabel: true,
									image: { select: { objectKey: true } },
								},
							},
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: { id: true, name: true, quantity: true, unit: true },
							},
						},
					},
				},
			},
		},
	})
	invariantResponse(menu, 'Menu not found', { status: 404 })
	const userId = await getUserId(request)
	const member = userId
		? await prisma.householdMember.findFirst({
				where: { userId },
				select: { householdId: true },
			})
		: null
	const saved = member ? await findSavedMenu(member.householdId, menu.id) : null
	return {
		isLoggedIn: Boolean(userId),
		savedMenuId: saved?.id ?? null,
		menu: {
			id: menu.id,
			title: menu.title,
			description: menu.description,
			defaultGuestCount: menu.defaultGuestCount,
			sections: menu.sections.map((section) => ({
				...section,
				items: section.items.map((item) => ({
					...item,
					recipe:
						item.recipe?.householdId === menu.householdId
							? {
									id: item.recipe.id,
									title: item.recipe.title,
									yieldAmount: item.recipe.yieldAmount,
									yieldLabel: item.recipe.yieldLabel,
									image: item.recipe.image,
								}
							: null,
				})),
			})),
		},
	}
}

export async function action({ params, request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	let savedId: string
	try {
		savedId = await saveSharedMenu({
			menuId: params.menuId,
			userId,
			householdId,
		})
	} catch (error) {
		if (error instanceof Response) {
			return data({ error: await error.text() }, { status: error.status })
		}
		console.error('Unable to save shared Menu', error)
		return data(
			{ error: 'Unable to save this Menu and its Recipes. Please try again.' },
			{ status: 500 },
		)
	}
	return redirect(`/recipes/menus/${savedId}`)
}

export default function SharedMenu({ loaderData }: Route.ComponentProps) {
	const { menu, savedMenuId, isLoggedIn } = loaderData
	const save = useFetcher<typeof action>()
	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<p className="text-muted-foreground mb-2 text-sm">
				Shared on{' '}
				<Link to="/" className="text-primary hover:underline">
					Quartermaster
				</Link>
			</p>
			<h1 className="font-serif text-3xl break-words">{menu.title}</h1>
			{menu.defaultGuestCount && (
				<p className="text-muted-foreground mt-2 text-sm">
					Usually for {menu.defaultGuestCount} guests
				</p>
			)}
			{menu.description && (
				<p className="text-muted-foreground mt-3 break-words whitespace-pre-wrap">
					{menu.description}
				</p>
			)}
			<div className="mt-5">
				{savedMenuId ? (
					<Button asChild>
						<Link to={`/recipes/menus/${savedMenuId}`}>Open my Menu</Link>
					</Button>
				) : isLoggedIn ? (
					<save.Form method="POST">
						<Button type="submit" disabled={save.state !== 'idle'}>
							<Icon name="plus" />
							{save.state !== 'idle' ? 'Saving…' : 'Save to my Menus'}
						</Button>
					</save.Form>
				) : (
					<Button asChild>
						<Link
							to={`/login?${new URLSearchParams({ redirectTo: `/share/menus/${menu.id}` })}`}
						>
							Save to my Menus
						</Link>
					</Button>
				)}
				{!savedMenuId && (
					<p className="text-muted-foreground mt-2 text-sm">
						Save your own copy of this Menu and its Recipes.
					</p>
				)}
				{save.data?.error && (
					<p role="alert" className="text-destructive mt-2 text-sm">
						{save.data.error}
					</p>
				)}
			</div>
			<MenuContents menu={menu} sharedMenuId={menu.id} />
		</div>
	)
}
