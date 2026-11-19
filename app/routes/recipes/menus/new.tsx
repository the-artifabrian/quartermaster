import { parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { isOfflineReply, saveUnlessOffline } from '#app/utils/offline-save.ts'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { menuNewNav } from '#app/utils/nav-back.ts'
import { data, replace, type ShouldRevalidateFunctionArgs } from 'react-router'
import { MENU_FORM_ID, MenuForm } from '#app/components/menu-form.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	DUPLICATE_MENU_TITLE_MESSAGE,
	isUniqueConstraintError,
	MenuSchema,
	menuTitleKey,
} from '#app/utils/menu-validation.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: menuNewNav,
	navForm: MENU_FORM_ID,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'New Menu | Quartermaster' }]
}

// Offline the reload would fail and replace the form with an error.
export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (isOfflineReply(actionResult)) return false
	return defaultShouldRevalidate
}

// A Save offline keeps the form and its edits (offline-save.ts).
export async function clientAction(args: Route.ClientActionArgs) {
	return saveUnlessOffline(args, MenuSchema)
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
		// The new Menu takes the form's place: going back from it goes to the
		// page before the form.
		return replace(`/recipes/menus/${menu.id}`)
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
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">New Menu</h1>
			<MenuForm />
		</div>
	)
}
