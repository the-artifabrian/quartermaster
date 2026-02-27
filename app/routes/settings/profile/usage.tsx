import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { getUsageStats } from '#app/utils/usage-stats.server.ts'
import { type Route } from './+types/usage.ts'
import { type SettingsPageHandle } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Usage Stats',
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Usage Stats | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	return getUsageStats(userId, householdId)
}

export default function UsageStats({ loaderData }: Route.ComponentProps) {
	const {
		recipeCount,
		cookCount,
		uniqueRecipesCooked,
		mostCookedRecipe,
		mealPlanWeekCount,
	} = loaderData

	return (
		<div className="space-y-8">
			<p className="text-muted-foreground text-sm">
				Your cooking activity over the last 90 days
			</p>

			{/* Cooking Activity */}
			<div className="bg-card shadow-warm rounded-xl border p-5">
				<h3 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
					Cooking Activity
				</h3>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
					<StatCard label="Total cooks" value={cookCount} />
					<StatCard label="Recipes in library" value={recipeCount} />
					<StatCard label="Unique recipes cooked" value={uniqueRecipesCooked} />
				</div>
				{mostCookedRecipe && (
					<p className="text-muted-foreground mt-3 text-sm">
						Most cooked:{' '}
						<span className="text-foreground font-medium">
							{mostCookedRecipe.title}
						</span>{' '}
						({mostCookedRecipe.count} times)
					</p>
				)}
			</div>

			{/* Meal Planning */}
			<div className="bg-card shadow-warm rounded-xl border p-5">
				<h3 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
					Meal Planning
				</h3>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
					<StatCard label="Weeks planned" value={mealPlanWeekCount} />
				</div>
			</div>

		</div>
	)
}

function StatCard({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="rounded-lg border p-3">
			<p className="text-2xl font-bold">{value}</p>
			<p className="text-muted-foreground text-xs">{label}</p>
		</div>
	)
}
