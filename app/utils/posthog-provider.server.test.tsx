import { renderToString } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { PostHogPageview, PostHogPwaLifecycle } from './posthog-provider.tsx'

test('analytics lifecycle components are safe to server render', () => {
	const router = createMemoryRouter(
		[
			{
				id: 'routes/test',
				path: '*',
				element: (
					<>
						<PostHogPageview />
						<PostHogPwaLifecycle />
					</>
				),
			},
		],
		{ initialEntries: ['/recipes/private-record-id'] },
	)

	expect(() => renderToString(<RouterProvider router={router} />)).not.toThrow()
})
