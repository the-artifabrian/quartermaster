import { parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect } from 'react-router'
import { MenuForm } from '#app/components/menu-form.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	DUPLICATE_MENU_TITLE_MESSAGE,
	isUniqueConstraintError,
	MenuSchema,
	menuTitleKey,
} from '#app/utils/menu-validation.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'New Menu | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)
	return {}
}

export async function action({ request }: Route.ActionArgs) {
	const { householdId } = await requireUserWithHousehold(request)

	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: MenuSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const { title, description, defaultGuestCount } = submission.value

	try {
		// One atomic create: the Menu and its starting unnamed section persist
		// together or not at all.
		const menu = await prisma.menu.create({
			data: {
				title,
				titleKey: menuTitleKey(title),
				description: description ?? null,
				defaultGuestCount: defaultGuestCount ?? null,
				householdId,
				sections: { create: { name: null, order: 0 } },
			},
			select: { id: true },
		})
		return redirect(`/recipes/menus/${menu.id}`)
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

export default function NewMenu() {
	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">New Menu</h1>
			<MenuForm submitLabel="Create Menu" />
		</div>
	)
}
