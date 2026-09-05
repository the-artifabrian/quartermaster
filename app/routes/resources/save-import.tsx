import { saveImportedRecipe } from '#app/utils/import-recipe-save.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/save-import.ts'

export async function action({ request }: Route.ActionArgs) {
	const user = await requireUserWithTier(request)
	return saveImportedRecipe(await request.formData(), user, true)
}
