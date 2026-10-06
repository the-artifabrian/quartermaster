// Creates the App Review demo account (issue #329, 3.3) through the same
// signup() the onboarding route uses: user, password, own Household, free
// trial. Run on the production machine, where the source is in the image:
//
//   fly ssh console -a quartermaster-94e5 -C \
//     "sh -c 'cd /myapp && DEMO_PASSWORD=<password> bun other/create-review-account.ts'"
//
// Locally: DATABASE_URL=file:/tmp/x.db bun other/create-review-account.ts
import { signup } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'

const email = process.env.DEMO_EMAIL ?? 'reviewer@useqm.app'
const username = process.env.DEMO_USERNAME ?? 'reviewer'
const password = process.env.DEMO_PASSWORD
if (!password || password.length < 12) {
	throw new Error('DEMO_PASSWORD (12+ characters) is required')
}

const existing = await prisma.user.findFirst({
	where: { OR: [{ email }, { username }] },
	select: { id: true },
})
if (existing) throw new Error(`A user with that email or username exists: ${existing.id}`)

const session = await signup({ email, username, password, name: 'App Review' })
const user = await prisma.user.findUniqueOrThrow({
	where: { id: session.userId },
	select: {
		id: true,
		email: true,
		username: true,
		householdMembers: { select: { householdId: true, role: true } },
		subscription: { select: { tier: true, trialEndsAt: true } },
	},
})
console.log(JSON.stringify(user, null, 2))
await prisma.$disconnect()
