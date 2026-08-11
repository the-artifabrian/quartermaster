import { assertApplicationHealthy } from '#app/utils/healthcheck.server.ts'

export async function loader() {
	try {
		await assertApplicationHealthy()
		return new Response('OK', {
			headers: { 'Cache-Control': 'no-store' },
		})
	} catch (error: unknown) {
		console.error('healthcheck ❌', { error })
		return new Response('ERROR', {
			status: 500,
			headers: { 'Cache-Control': 'no-store' },
		})
	}
}
