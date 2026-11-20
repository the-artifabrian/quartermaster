/**
 * Lists saved ingredient rows whose amount looks split, or reads differently
 * now. It only reads: the database is opened read-only, so it is safe against
 * production.
 *
 *   bun scripts/find-split-amounts.ts [path/to/data.db] [--json]
 *
 * The path defaults to DATABASE_PATH. A database in WAL mode opens read-only
 * only while something else holds it open, as the running app does. Otherwise
 * run it against a copy:
 *
 *   sqlite3 "$DATABASE_PATH" ".backup /tmp/check.db"
 *   sqlite3 /tmp/check.db "PRAGMA journal_mode=DELETE"
 *
 * Before comma decimals and thousands separators were understood, an import
 * could cut "1,5 kg flour" into the name "1" and the notes "5 kg flour", or
 * "800–1,000 g flour" into the name "800–1", and "2 x 400 g tomatoes" into the
 * amount "2" and the name "x 400 g tomatoes". Each row printed has one of
 * these reasons:
 *
 * - number-name: the name is only a number or range, so its amount ended up
 *   in the name and notes.
 * - split-thousands: the name ends in a digit and the notes start with three
 *   digits, the rest of a number cut at its comma.
 * - pack-size-name: the name starts with "x 400" or "× 400".
 * - number-start-name: the name starts with a digit or a fraction, so the
 *   amount may have been cut short: "1" and "1/2 pounds ground beef", or
 *   "1" and "000 g flour" from thousands written with a space. A name such
 *   as "2% milk" shows up too.
 * - reading-changed: the amount reads differently now ("1,5" was 1 and is
 *   1.5; "1,250" and "2 large" were 1 and 2 and are now kept as written).
 *   Not broken, but its totals and scaling changed.
 */
import {
	isRangeAmount,
	parseAmount,
	parseRangeAmount,
} from '#app/utils/fractions.ts'

type Row = {
	id: string
	recipeId: string
	title: string
	amount: string | null
	unit: string | null
	name: string
	notes: string | null
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
	query: (sql: string) => { all: () => Row[] }
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
const rows = db
	.query(
		`SELECT i.id, i.recipeId, r.title, i.amount, i.unit, i.name, i.notes
		 FROM Ingredient i JOIN Recipe r ON r.id = i.recipeId
		 WHERE i.isHeading = 0
		 ORDER BY r.title, i."order"`,
	)
	.all()
db.close()

const NUMBER_ONLY = /^~?[\d.,/½⅓⅔¼¾⅛⅜⅝⅞]+(?:\s*[-–—]\s*[\d.,/½⅓⅔¼¾⅛⅜⅝⅞]+)?$/

// How amounts were read before comma decimals were understood: a range
// without commas, else a fraction, else whatever number started the string.
const OLD_RANGE =
	/^\s*(\d[\d\s./½⅓⅔¼¾⅛⅜⅝⅞]*?|[½⅓⅔¼¾⅛⅜⅝⅞])\s*([-–—~]|to)\s*(\d[\d\s./½⅓⅔¼¾⅛⅜⅝⅞]*|[½⅓⅔¼¾⅛⅜⅝⅞])\s*$/i

function oldReading(amount: string): string {
	const range = OLD_RANGE.exec(amount)
	if (range) {
		const low = oldNumber(range[1]!)
		const high = oldNumber(range[3]!)
		return low === null || high === null ? 'as written' : `${low} to ${high}`
	}
	return String(oldNumber(amount) ?? 'as written')
}

function oldNumber(amount: string): number | null {
	const text = amount.trim()
	// Fractions and mixed numbers read the same then as now.
	if (/^[\d\s/½⅓⅔¼¾⅛⅜⅝⅞]+$/.test(text) && /[/½⅓⅔¼¾⅛⅜⅝⅞]/.test(text)) {
		return parseAmount(text)
	}
	const value = parseFloat(text)
	return Number.isNaN(value) ? null : value
}

function newReading(amount: string): string {
	if (isRangeAmount(amount)) {
		const range = parseRangeAmount(amount)
		return range ? `${range.low} to ${range.high}` : 'as written'
	}
	return String(parseAmount(amount) ?? 'as written')
}

function reasonFor(row: Row): string | null {
	const name = row.name.trim()
	const notes = row.notes?.trim() ?? ''
	if (NUMBER_ONLY.test(name)) return 'number-name'
	if (/\d$/.test(name) && /^\d{3}\b/.test(notes)) return 'split-thousands'
	if (/^[x×]\s*\d/i.test(name)) return 'pack-size-name'
	if (/^[\d½⅓⅔¼¾⅛⅜⅝⅞]/.test(name)) return 'number-start-name'
	const amount = row.amount?.trim()
	if (amount) {
		const before = oldReading(amount)
		const now = newReading(amount)
		if (before !== now) return `reading-changed: ${before} → ${now}`
	}
	return null
}

const found = rows.flatMap((row) => {
	const reason = reasonFor(row)
	return reason ? [{ reason, ...row }] : []
})

if (json) {
	console.log(JSON.stringify(found, null, 2))
} else {
	console.log(`${found.length} of ${rows.length} ingredient rows to look at`)
	for (const row of found) {
		const saved = [row.amount, row.unit, row.name].filter(Boolean).join(' ')
		const notes = row.notes ? ` (notes: ${row.notes})` : ''
		console.log(
			`${row.reason}\t${row.title}\t${saved}${notes}\tingredient ${row.id}, recipe ${row.recipeId}`,
		)
	}
}
