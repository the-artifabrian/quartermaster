import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'

/**
 * Run `work` in one transaction that holds SQLite's write lock from its first
 * statement.
 *
 * Prisma begins interactive transactions deferred, so a transaction takes no
 * lock until a statement needs one. One that reads and then writes has to
 * upgrade its lock at the first write, and SQLite fails that upgrade at once,
 * without waiting out the busy timeout, when another connection wrote in
 * between (in WAL mode, SQLITE_BUSY_SNAPSHOT; Prisma reports "Operation has
 * timed out"). Taking the write lock first makes any other writer wait on the
 * busy timeout instead, and nothing the transaction reads can change before it
 * writes.
 *
 * Use it for an interactive transaction that reads, or decides what to write,
 * before its first write. One whose first statement already writes holds the
 * lock from the start and does not need it.
 *
 * The lock statement matches no row: SQLite's write lock covers the whole
 * database, and an UPDATE takes it even when nothing matches. So it needs no
 * id, works when a row is gone, and changes no page.
 */
export function writeTransaction<T>(
	db: Pick<PrismaClient, '$transaction'>,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return db.$transaction(async (tx) => {
		await tx.$executeRaw`UPDATE "Household" SET "name" = "name" WHERE 0`
		return work(tx)
	})
}
