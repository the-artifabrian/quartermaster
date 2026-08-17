import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect, useFetcher } from 'react-router'
import { MenuForm } from '#app/components/menu-form.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	DUPLICATE_MENU_TITLE_MESSAGE,
	isUniqueConstraintError,
	MenuSchema,
	menuTitleKey,
} from '#app/utils/menu-validation.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { type Route } from './+types/$menuId_.edit.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Edit Menu | Quartermaster' }]
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
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	return { menu }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: { id: true, householdId: true },
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	const formData = await request.formData()

	if (formData.get('intent') === 'delete') {
		await prisma.menu.delete({ where: { id: menuId } })
		return redirect('/recipes/menus')
	}

	const submission = parseWithZod(formData, { schema: MenuSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const { title, description, defaultGuestCount } = submission.value

	try {
		// One atomic update — the Menu changes as a whole on explicit Save.
		await prisma.menu.update({
			where: { id: menuId },
			data: {
				title,
				titleKey: menuTitleKey(title),
				description: description ?? null,
				defaultGuestCount: defaultGuestCount ?? null,
			},
		})
		return redirect(`/recipes/menus/${menuId}`)
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			return data(
				{
					result: submission.reply({
						fieldErrors: { title: [DUPLICATE_MENU_TITLE_MESSAGE] },
					}),
				},
				{ status: 400 },
			)
		}
		throw error
	}
}

export default function EditMenu({ loaderData }: Route.ComponentProps) {
	const { menu } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">Edit Menu</h1>
			<MenuForm menu={menu} submitLabel="Save Changes" />
			<div className="mt-8 border-t pt-8">
				<DeleteMenu />
			</div>
		</div>
	)
}

function DeleteMenu() {
	const dc = useDoubleCheck()
	const fetcher = useFetcher()
	const isDeleting = fetcher.state !== 'idle'

	return (
		<fetcher.Form method="POST">
			<input type="hidden" name="intent" value="delete" />
			<StatusButton
				{...dc.getButtonProps({
					type: 'submit',
					name: 'intent',
					value: 'delete',
				})}
				variant={dc.doubleCheck ? 'destructive' : 'outline'}
				status={isDeleting ? 'pending' : 'idle'}
			>
				<Icon name="trash" size="sm">
					{dc.doubleCheck ? 'Are you sure?' : 'Delete Menu'}
				</Icon>
			</StatusButton>
		</fetcher.Form>
	)
}
