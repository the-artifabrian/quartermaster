import { createHash, createHmac } from 'node:crypto'

/**
 * Minimal AWS SigV4 signer for the Tigris bucket. Extracted from
 * `storage.server.ts` so the backup tooling (`server/backup.ts`) signs
 * requests the same way the image uploads do, instead of carrying a second
 * copy of the crypto.
 *
 * Every request is signed with `UNSIGNED-PAYLOAD`, so bodies never have to be
 * buffered to hash them — the payload is still protected by TLS, just not by
 * the signature.
 */

export type S3Credentials = {
	endpoint: string
	bucket: string
	accessKeyId: string
	secretAccessKey: string
	region: string
}

const ALGORITHM = 'AWS4-HMAC-SHA256'
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

export function getS3CredentialsFromEnv(
	env: Record<string, string | undefined> = process.env,
): S3Credentials {
	const credentials = {
		endpoint: env.AWS_ENDPOINT_URL_S3,
		bucket: env.BUCKET_NAME,
		accessKeyId: env.AWS_ACCESS_KEY_ID,
		secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
		region: env.AWS_REGION,
	}
	const missing = Object.entries(credentials)
		.filter(([, value]) => !value)
		.map(([name]) => name)
	if (missing.length) {
		throw new Error(
			`Missing object storage configuration: ${missing.join(', ')}`,
		)
	}
	return credentials as S3Credentials
}

function hmacSha256(key: string | Buffer, message: string) {
	return createHmac('sha256', key).update(message).digest()
}

function sha256(message: string) {
	return createHash('sha256').update(message).digest('hex')
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string) {
	const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp)
	const kRegion = hmacSha256(kDate, region)
	const kService = hmacSha256(kRegion, 's3')
	return hmacSha256(kService, 'aws4_request')
}

/**
 * `encodeURIComponent` leaves a handful of characters SigV4 expects to be
 * percent-encoded, and S3 rejects the request if our canonical query string
 * disagrees with the one it derives from the URL by a single byte.
 */
function encodeRfc3986(value: string) {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	)
}

export function signS3Request({
	credentials,
	method,
	key,
	query = {},
	headers = {},
	now = new Date(),
}: {
	credentials: S3Credentials
	method: 'GET' | 'PUT' | 'DELETE' | 'HEAD'
	/** Object key, without the bucket prefix. */
	key: string
	query?: Record<string, string>
	/** Extra headers to sign; returned verbatim alongside the signature. */
	headers?: Record<string, string | undefined>
	now?: Date
}) {
	const { endpoint, bucket, region, accessKeyId, secretAccessKey } = credentials
	// Encoded per segment: `fetch` will percent-encode whatever the path needs
	// anyway, and if we signed the raw form the two would disagree and S3 would
	// answer 403. Image keys end in an extension taken from the uploaded
	// filename, so a space in there is a user away.
	const canonicalUri = `/${bucket}/${key}`
		.split('/')
		.map(encodeRfc3986)
		.join('/')
	// Built by hand rather than via URLSearchParams: the canonical query string
	// and the one on the wire have to be byte-identical, and URLSearchParams
	// encodes '/' and spaces differently than SigV4 requires.
	const canonicalQuery = Object.keys(query)
		.sort()
		.map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name]!)}`)
		.join('&')

	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
	const dateStamp = amzDate.slice(0, 8)

	const signedValues: Record<string, string> = {
		host: new URL(endpoint).host,
		'x-amz-content-sha256': UNSIGNED_PAYLOAD,
		'x-amz-date': amzDate,
	}
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) continue
		signedValues[name.toLowerCase()] = value
	}

	const signedNames = Object.keys(signedValues).sort()
	const canonicalHeaders =
		signedNames.map((name) => `${name}:${signedValues[name]}`).join('\n') + '\n'
	const signedHeaders = signedNames.join(';')

	const canonicalRequest = [
		method,
		canonicalUri,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		UNSIGNED_PAYLOAD,
	].join('\n')

	const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
	const stringToSign = [
		ALGORITHM,
		amzDate,
		credentialScope,
		sha256(canonicalRequest),
	].join('\n')

	const signature = createHmac(
		'sha256',
		getSignatureKey(secretAccessKey, dateStamp, region),
	)
		.update(stringToSign)
		.digest('hex')

	const definedHeaders = Object.fromEntries(
		Object.entries(headers).filter(([, value]) => value !== undefined),
	) as Record<string, string>

	const requestHeaders: Record<string, string> = {
		...definedHeaders,
		'X-Amz-Date': amzDate,
		'X-Amz-Content-SHA256': UNSIGNED_PAYLOAD,
		Authorization: [
			`${ALGORITHM} Credential=${accessKeyId}/${credentialScope}`,
			`SignedHeaders=${signedHeaders}`,
			`Signature=${signature}`,
		].join(', '),
	}

	return {
		url: `${endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
		headers: requestHeaders,
	}
}
