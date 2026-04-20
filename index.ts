import 'dotenv/config'

if (process.env.MOCKS === 'true') {
	await import('./tests/mocks/index.ts')
}

await import('./server/index.ts')
