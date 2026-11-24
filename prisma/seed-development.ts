import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { createOwnHousehold, getPasswordHash } from '#app/utils/auth.server.ts'
import { ensureDemoTemplate } from '#app/utils/demo.server.ts'
import { fillSampleHousehold } from '#app/utils/sample-household.server.ts'

/**
 * The local logins `prisma db seed` creates. The README gives them, so keep
 * the two in step. Sample data for a local database only; production runs
 * `run-seed-infrastructure.ts` instead.
 */
export const SAMPLE_PASSWORD = 'local-only'

/** Owns the sample Household. An admin, on Pro. */
export const SAMPLE_OWNER = {
	username: 'sam',
	name: 'Sam',
	email: 'sam@example.com',
	roles: ['admin', 'user'],
}

/** Has an empty Household of their own, for trying invites and joins. */
export const SECOND_USER = {
	username: 'robin',
	name: 'Robin',
	email: 'robin@example.com',
	roles: ['user'],
}

/**
 * Throws on Fly or with NODE_ENV=production. Without it, `prisma db seed` in a
 * production shell would make an admin whose password the README gives.
 */
export function assertLocalDatabase() {
	if (process.env.FLY || process.env.NODE_ENV === 'production') {
		throw new Error(
			'The development seed is for a local database only. Production runs prisma/run-seed-infrastructure.ts.',
		)
	}
}

/**
 * Creates both users, each with their own Household and Pro, and fills the
 * owner's Household with sample data for the week of `today`. Then builds the
 * demo template from the photos in `demoPhotoDir`, as the server does at
 * startup. Safe to run again: users are found by username,
 * fillSampleHousehold adds only what is missing, and the template is rebuilt
 * only when the content or a photo changed.
 */
export async function seedDevelopment(
	db: PrismaClient,
	{ today, demoPhotoDir }: { today: string; demoPhotoDir?: string },
) {
	assertLocalDatabase()
	const owner = await ensureUser(db, SAMPLE_OWNER)
	const second = await ensureUser(db, SECOND_USER)
	for (const user of [owner, second]) {
		await db.subscription.upsert({
			where: { userId: user.id },
			update: { tier: 'pro', subscriptionExpiresAt: new Date('2099-12-31') },
			create: {
				userId: user.id,
				tier: 'pro',
				subscriptionExpiresAt: new Date('2099-12-31'),
			},
		})
	}
	await fillSampleHousehold(db, {
		userId: owner.id,
		householdId: owner.householdId,
		today,
	})
	await ensureDemoTemplate(db, { photoDir: demoPhotoDir })
	return { owner, second }
}

async function ensureUser(
	db: PrismaClient,
	person: typeof SAMPLE_OWNER | typeof SECOND_USER,
) {
	const user =
		(await db.user.findUnique({
			where: { username: person.username },
			select: { id: true, name: true, username: true },
		})) ??
		(await db.user.create({
			select: { id: true, name: true, username: true },
			data: {
				username: person.username,
				name: person.name,
				email: person.email,
				password: {
					create: { hash: await getPasswordHash(SAMPLE_PASSWORD) },
				},
				roles: { connect: person.roles.map((name) => ({ name })) },
			},
		}))
	// The Household they own, never one they joined: a sample owner who
	// joined Robin's Household must not have it filled on the next seed.
	const membership = await db.householdMember.findFirst({
		where: { userId: user.id, role: 'owner' },
		orderBy: { createdAt: 'asc' },
		select: { householdId: true },
	})
	const householdId =
		membership?.householdId ?? (await createOwnHousehold(db, user)).id
	return { id: user.id, householdId }
}
