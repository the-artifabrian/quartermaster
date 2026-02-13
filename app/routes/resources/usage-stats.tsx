import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { getUsageStats } from '#app/utils/usage-stats.server.ts'
import { type Route } from './+types/usage-stats.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	return getUsageStats(userId, householdId)
}
