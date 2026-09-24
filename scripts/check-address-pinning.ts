/**
 * Checks the Recipe URL import's address pinning under Bun, which runs
 * production. Vitest runs under Node, so nothing else exercises the Bun
 * behaviour that `unguardedFetchFrom` in app/utils/public-url.server.ts
 * relies on: `tls.serverName` sets SNI, names the certificate check, and keys
 * the keep-alive pool. Run it after upgrading Bun:
 * `bun run test:address-pinning`.
 *
 * It makes a throwaway CA and a certificate for on-cert.test, then runs itself
 * again with NODE_EXTRA_CA_CERTS, which Bun reads only at startup. Requests go
 * to 127.0.0.1 by address, so no .test name is ever looked up.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { unguardedFetchFrom } from '#app/utils/public-url.server.ts'

const ON_CERT = 'on-cert.test'
const OFF_CERT = 'off-cert.test'
// Bun's code for a certificate that does not cover the requested name.
const NAME_MISMATCH = 'ERR_TLS_CERT_ALTNAME_INVALID'
const CERT_DIR = 'ADDRESS_PINNING_CERT_DIR'

if (!process.versions.bun) {
	console.error('Run this with bun. It checks the behaviour of Bun’s fetch.')
	process.exit(1)
}
const certDir = process.env[CERT_DIR]
process.exit(certDir ? await check(certDir) : runWithThrowawayCa())

function runWithThrowawayCa() {
	const dir = mkdtempSync(join(tmpdir(), 'address-pinning-'))
	try {
		makeCertificates(dir)
		const child = spawnSync(
			process.execPath,
			[fileURLToPath(import.meta.url)],
			{
				stdio: 'inherit',
				timeout: 30_000,
				env: {
					...process.env,
					[CERT_DIR]: dir,
					NODE_EXTRA_CA_CERTS: join(dir, 'ca.crt'),
				},
			},
		)
		if (child.status === null) {
			console.error(`The check did not finish: ${child.error ?? child.signal}`)
		}
		return child.status ?? 1
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

// Written for both OpenSSL and macOS's LibreSSL. LibreSSL ignores -subj when
// the config sets `prompt = no`, so each subject comes from -subj.
function makeCertificates(dir: string) {
	writeFileSync(
		join(dir, 'openssl.cnf'),
		[
			'[req]',
			'distinguished_name = dn',
			'[dn]',
			'[v3_ca]',
			'basicConstraints = critical, CA:TRUE',
			'keyUsage = critical, keyCertSign',
			'[v3_leaf]',
			'basicConstraints = critical, CA:FALSE',
			'extendedKeyUsage = serverAuth',
			`subjectAltName = DNS:${ON_CERT}`,
		].join('\n'),
	)
	const newKey = '-newkey rsa:2048 -nodes -config openssl.cnf'
	openssl(
		dir,
		`req -x509 ${newKey} -subj /CN=address-pinning-ca -extensions v3_ca -days 1 -keyout ca.key -out ca.crt`,
	)
	openssl(
		dir,
		`req -new ${newKey} -subj /CN=${ON_CERT} -keyout leaf.key -out leaf.csr`,
	)
	openssl(
		dir,
		'x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -set_serial 1 -days 1 -extfile openssl.cnf -extensions v3_leaf -out leaf.crt',
	)
}

function openssl(cwd: string, command: string) {
	const result = spawnSync('openssl', command.split(' '), {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	if (result.status !== 0) {
		throw new Error(
			`openssl ${command} failed: ${result.stderr || result.error}`,
		)
	}
}

type Seen = {
	path?: string
	host?: string
	sni: string | false | null
	connection: number
}

async function check(dir: string) {
	// Bun's node:https server does not report SNI, so this is a bare HTTP/1.1
	// responder on node:tls. It keeps connections open so that Bun pools them.
	const seen: Array<Seen> = []
	let connections = 0
	const server = tls.createServer(
		{
			key: readFileSync(join(dir, 'leaf.key')),
			cert: readFileSync(join(dir, 'leaf.crt')),
		},
		(socket) => {
			const connection = ++connections
			let buffered = ''
			socket.on('error', () => {})
			socket.on('data', (chunk: Buffer) => {
				buffered += chunk.toString('latin1')
				let end
				while ((end = buffered.indexOf('\r\n\r\n')) !== -1) {
					const [requestLine = '', ...fields] = buffered
						.slice(0, end)
						.split('\r\n')
					buffered = buffered.slice(end + 4)
					seen.push({
						path: requestLine.split(' ')[1],
						host: fields
							.find((f) => /^host:/i.test(f))
							?.slice(5)
							.trim(),
						sni: socket.servername,
						connection,
					})
					socket.write('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok')
				}
			})
		},
	)
	server.on('tlsClientError', () => {})
	// Listening only on 127.0.0.1 means any request seen here reached it.
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve()),
	)
	const { port } = server.address() as AddressInfo

	async function request(name: string, path: string) {
		const target = {
			url: new URL(`https://${name}:${port}${path}`),
			hostname: name,
			addresses: ['127.0.0.1'],
		}
		let error: string | undefined
		try {
			const response = await unguardedFetchFrom(target, '127.0.0.1', {
				signal: AbortSignal.timeout(5_000),
			})
			await response.text()
		} catch (caught) {
			error = (caught as { code?: string }).code ?? String(caught)
		}
		return { error, seen: seen.find((s) => s.path === path) }
	}

	// Only a name mismatch counts, so an unrelated connection error cannot pass
	// for a refusal.
	const refused = (result: { error?: string; seen?: Seen }) =>
		result.error === NAME_MISMATCH && !result.seen

	let failures = 0
	function verify(pass: boolean, claim: string, result: object) {
		if (!pass) failures++
		const detail = pass ? '' : `\n        got ${JSON.stringify(result)}`
		console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${claim}${detail}`)
	}

	console.log(
		`Address pinning under Bun ${process.versions.bun}, server on 127.0.0.1:${port}`,
	)

	// First, while the pool is empty: this is the certificate name check alone.
	const fresh = await request(OFF_CERT, '/off-cert-fresh')
	verify(
		refused(fresh),
		`${OFF_CERT} is refused with ${NAME_MISMATCH} on a new connection`,
		fresh,
	)

	const first = await request(ON_CERT, '/on-cert-first')
	verify(
		!first.error && first.seen?.host === `${ON_CERT}:${port}`,
		`${ON_CERT} pinned to 127.0.0.1 arrives with Host ${ON_CERT}:${port}`,
		first,
	)
	verify(first.seen?.sni === ON_CERT, `the server sees SNI ${ON_CERT}`, first)

	// The refusal below only tests the pool if Bun really pools this socket.
	const pooled = await request(ON_CERT, '/on-cert-pooled')
	verify(
		!pooled.error &&
			pooled.seen !== undefined &&
			pooled.seen.connection === first.seen?.connection,
		`a second ${ON_CERT} request reuses the pooled connection`,
		{ first, pooled },
	)

	const afterPool = await request(OFF_CERT, '/off-cert-after-pool')
	verify(
		refused(afterPool),
		`${OFF_CERT} is still refused with ${NAME_MISMATCH} right after that pooled success`,
		afterPool,
	)

	return failures === 0 ? 0 : 1
}
