/**
 * Lists what a repair of leftover Household data would touch. It only reads:
 * the database is opened read-only, so it is safe against production.
 *
 *   bun scripts/find-household-orphans.ts [path/to/data.db] [--json]
 *
 * The path defaults to DATABASE_PATH. A database in WAL mode opens read-only
 * only while something else holds it open, as the running app does. Otherwise
 * run it against a copy:
 *
 *   sqlite3 "$DATABASE_PATH" ".backup /tmp/check.db"
 *   sqlite3 /tmp/check.db "PRAGMA journal_mode=DELETE"
 *
 * Before every way out of a Household went through `removeMembership`, an
 * owner who joined another Household left the old one without an owner, and
 * when its last member then left, the Household was deleted while its Recipes
 * and Shopping list stayed behind with no Household. It prints:
 *
 * - Households with members but no owner, and the heir `findHeir` would pick
 *   (an owner first, else the member who joined longest ago, then by id).
 * - Households with no members at all.
 * - Recipes with no Household, with their photo key and whether any Recipe
 *   that still has a Household shows the same file.
 * - Shopping lists with no Household, with their item count.
 */
export {}

type Member = {
	householdId: string
	householdName: string
	memberId: string
	userId: string
	username: string
	role: string
	createdAt: number | string
}

type EmptyHousehold = { id: string; name: string; createdAt: number | string }

type OrphanRecipe = {
	id: string
	title: string
	userId: string
	createdAt: number | string
	objectKey: string | null
	keptReferences: number
}

type OrphanList = {
	id: string
	userId: string
	createdAt: number | string
	itemCount: number
}

const args = process.argv.slice(2)
const json = args.includes('--json')
const path =
	args.find((arg) => !arg.startsWith('--')) ?? process.env.DATABASE_PATH
if (!path) {
	console.error('Pass the database path, or set DATABASE_PATH.')
	process.exit(1)
}

// Bun's own SQLite opens the file read-only. The repo has no Bun types, so
// the module is named through a variable and given the little it needs.
type ReadOnlyDatabase = {
	query: <Row>(sql: string) => { all: () => Row[] }
	close: () => void
}
const bunSqlite = 'bun:sqlite'
const { Database } = (await import(bunSqlite)) as {
	Database: new (
		path: string,
		options: { readonly: boolean },
	) => ReadOnlyDatabase
}
const db = new Database(path, { readonly: true })

const ownerlessMembers = db
	.query<Member>(
		`SELECT h.id AS householdId, h.name AS householdName, m.id AS memberId,
		        m.userId, u.username, m.role, m.createdAt
		 FROM HouseholdMember m
		 JOIN Household h ON h.id = m.householdId
		 JOIN User u ON u.id = m.userId
		 WHERE NOT EXISTS (
		   SELECT 1 FROM HouseholdMember o
		   WHERE o.householdId = m.householdId AND o.role = 'owner'
		 )`,
	)
	.all()

const emptyHouseholds = db
	.query<EmptyHousehold>(
		`SELECT h.id, h.name, h.createdAt FROM Household h
		 WHERE NOT EXISTS (
		   SELECT 1 FROM HouseholdMember m WHERE m.householdId = h.id
		 )`,
	)
	.all()

const orphanRecipes = db
	.query<OrphanRecipe>(
		`SELECT r.id, r.title, r.userId, r.createdAt, i.objectKey,
		        (SELECT COUNT(*) FROM RecipeImage k
		         JOIN Recipe kr ON kr.id = k.recipeId
		         WHERE i.objectKey IS NOT NULL AND k.objectKey = i.objectKey
		           AND kr.householdId IS NOT NULL) AS keptReferences
		 FROM Recipe r
		 LEFT JOIN RecipeImage i ON i.recipeId = r.id
		 WHERE r.householdId IS NULL
		 ORDER BY r.userId, r.title`,
	)
	.all()

const orphanLists = db
	.query<OrphanList>(
		`SELECT l.id, l.userId, l.createdAt,
		        (SELECT COUNT(*) FROM ShoppingListItem i WHERE i.listId = l.id)
		          AS itemCount
		 FROM ShoppingList l
		 WHERE l.householdId IS NULL`,
	)
	.all()
db.close()

// DateTime columns hold epoch milliseconds in older rows and ISO text in newer
// ones. SQLite sorts every number before every text, so order them here.
function toTime(value: number | string) {
	return typeof value === 'number' ? value : new Date(value).getTime()
}
function toIso(value: number | string) {
	return new Date(toTime(value)).toISOString()
}

const membersByHousehold = new Map<string, Member[]>()
for (const member of ownerlessMembers) {
	const members = membersByHousehold.get(member.householdId) ?? []
	members.push(member)
	membersByHousehold.set(member.householdId, members)
}
const ownerless = [...membersByHousehold.values()].map((members) => {
	const ordered = members
		.map((member) => ({ ...member, joinedAt: toIso(member.createdAt) }))
		.sort(
			(a, b) =>
				toTime(a.createdAt) - toTime(b.createdAt) ||
				(a.memberId < b.memberId ? -1 : 1),
		)
	const heir = ordered[0]!
	return {
		householdId: heir.householdId,
		householdName: heir.householdName,
		heir: { userId: heir.userId, username: heir.username },
		members: ordered.map(({ userId, username, role, joinedAt }) => ({
			userId,
			username,
			role,
			joinedAt,
		})),
	}
})

const report = {
	ownerlessHouseholds: ownerless,
	emptyHouseholds: emptyHouseholds.map((household) => ({
		...household,
		createdAt: toIso(household.createdAt),
	})),
	orphanRecipes: orphanRecipes.map((recipe) => ({
		...recipe,
		createdAt: toIso(recipe.createdAt),
		fileStillShown: recipe.keptReferences > 0,
	})),
	orphanShoppingLists: orphanLists.map((list) => ({
		...list,
		createdAt: toIso(list.createdAt),
	})),
}

if (json) {
	console.log(JSON.stringify(report, null, 2))
} else {
	console.log(
		`${ownerless.length} Households with members and no owner (heir would become owner)`,
	)
	for (const household of ownerless) {
		console.log(
			`  ${household.householdId}\t${household.householdName}\their @${household.heir.username} (${household.heir.userId})`,
		)
		for (const member of household.members) {
			console.log(
				`    @${member.username}\t${member.role}\tjoined ${member.joinedAt}`,
			)
		}
	}
	console.log(`${report.emptyHouseholds.length} Households with no members`)
	for (const household of report.emptyHouseholds) {
		console.log(
			`  ${household.id}\t${household.name}\tcreated ${household.createdAt}`,
		)
	}
	console.log(`${report.orphanRecipes.length} Recipes with no Household`)
	for (const recipe of report.orphanRecipes) {
		const photo = recipe.objectKey
			? `${recipe.objectKey} (${recipe.fileStillShown ? 'file still shown elsewhere, keep' : 'file shown nowhere else'})`
			: 'no photo'
		console.log(
			`  ${recipe.id}\t${recipe.title}\tby ${recipe.userId}\t${recipe.createdAt}\t${photo}`,
		)
	}
	console.log(
		`${report.orphanShoppingLists.length} Shopping lists with no Household`,
	)
	for (const list of report.orphanShoppingLists) {
		console.log(
			`  ${list.id}\tby ${list.userId}\t${list.itemCount} items\t${list.createdAt}`,
		)
	}
}
