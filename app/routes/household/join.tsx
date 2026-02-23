import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { getInviteByToken, acceptInvite } from '#app/utils/household.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/join.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Join Household | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const token = url.searchParams.get('token')

	if (!token) {
		throw await redirectWithToast('/', {
			type: 'error',
			description: 'No invite token provided',
		})
	}

	const invite = await getInviteByToken(token)
	if (!invite) {
		throw await redirectWithToast('/', {
			type: 'error',
			description: 'This invite link is invalid or has expired',
		})
	}

	// Check if user is already a member
	const existingMember = await prisma.householdMember.findUnique({
		where: {
			householdId_userId: { householdId: invite.householdId, userId },
		},
	})
	if (existingMember) {
		throw await redirectWithToast('/settings/profile/household', {
			type: 'message',
			description: 'You are already a member of this household',
		})
	}

	return {
		householdName: invite.household.name,
		token,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')
	const token = formData.get('token')

	if (typeof token !== 'string') {
		throw await redirectWithToast('/', {
			type: 'error',
			description: 'No invite token provided',
		})
	}

	if (intent === 'decline') {
		return redirectWithToast('/', {
			type: 'message',
			description: 'Invite declined',
		})
	}

	try {
		const invite = await getInviteByToken(token)
		await acceptInvite(token, userId)
		if (invite) {
			void emitHouseholdEvent({
				type: 'household_member_joined',
				payload: {},
				userId,
				householdId: invite.householdId,
			})
		}
		return redirectWithToast('/recipes', {
			type: 'success',
			title: 'Joined household!',
			description: 'You are now a member of the household',
		})
	} catch (error) {
		const knownMessages = [
			'Invalid or expired invite',
			'Already a member of this household',
			'Invite already used',
		]
		const message =
			error instanceof Error && knownMessages.includes(error.message)
				? error.message
				: 'Failed to join household'
		return redirectWithToast('/', {
			type: 'error',
			description: message,
		})
	}
}

export default function JoinHousehold({ loaderData }: Route.ComponentProps) {
	const { householdName, token } = loaderData

	return (
		<div className="m-auto mt-16 mb-24 max-w-md">
			<div className="container">
				<div className="bg-muted rounded-3xl px-8 py-12 text-center">
					<h1 className="font-serif text-xl mb-4">Join Household</h1>
					<p className="text-lg text-muted-foreground mb-8">
						You've been invited to join{' '}
						<strong className="text-foreground">{householdName}</strong>
					</p>
					<Form method="POST" className="flex justify-center gap-4">
						<input type="hidden" name="token" value={token} />
						<Button type="submit" name="intent" value="accept" size="lg">
							Accept
						</Button>
						<Button
							type="submit"
							name="intent"
							value="decline"
							variant="outline"
							size="lg"
						>
							Decline
						</Button>
					</Form>
				</div>
			</div>
		</div>
	)
}
