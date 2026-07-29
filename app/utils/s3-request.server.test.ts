import { expect, test } from 'vitest'
import {
	getS3CredentialsFromEnv,
	type S3Credentials,
	signS3Request,
} from './s3-request.server.ts'

const credentials: S3Credentials = {
	endpoint: 'https://fly.storage.tigris.dev',
	bucket: 'quartermaster',
	accessKeyId: 'AKIAEXAMPLE',
	secretAccessKey: 'secret',
	region: 'auto',
}
const now = new Date('2026-07-29T04:17:00.000Z')

function authorization(headers: Record<string, string>) {
	const [credential, signedHeaders, signature] =
		headers.Authorization!.split(', ')
	return { credential, signedHeaders, signature }
}

test('signs a plain GET with the headers S3 expects', () => {
	const { url, headers } = signS3Request({
		credentials,
		method: 'GET',
		key: 'users/1/recipes/2/images/photo.jpg',
		now,
	})

	expect(url).toBe(
		'https://fly.storage.tigris.dev/quartermaster/users/1/recipes/2/images/photo.jpg',
	)
	expect(headers['X-Amz-Date']).toBe('20260729T041700Z')
	expect(headers['X-Amz-Content-SHA256']).toBe('UNSIGNED-PAYLOAD')
	const { credential, signedHeaders, signature } = authorization(headers)
	expect(credential).toBe(
		'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260729/auto/s3/aws4_request',
	)
	expect(signedHeaders).toBe(
		'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
	)
	expect(signature).toMatch(/^Signature=[0-9a-f]{64}$/)
})

test('a key with characters fetch would escape is signed in its escaped form', () => {
	// Image keys end in an extension lifted from the uploaded filename.
	const { url, headers } = signS3Request({
		credentials,
		method: 'PUT',
		key: 'users/1/notes/2/images/photo.jp g',
		now,
	})

	expect(url).toBe(
		'https://fly.storage.tigris.dev/quartermaster/users/1/notes/2/images/photo.jp%20g',
	)
	// Same string the signature was computed over, so S3 agrees.
	expect(new URL(url).pathname).toBe(
		'/quartermaster/users/1/notes/2/images/photo.jp%20g',
	)
	expect(authorization(headers).signature).toMatch(/^Signature=[0-9a-f]{64}$/)
})

test('extra headers are signed in lowercase order and returned as given', () => {
	const { headers } = signS3Request({
		credentials,
		method: 'PUT',
		key: 'photo.jpg',
		headers: {
			'Content-Type': 'image/jpeg',
			'X-Amz-Meta-Upload-Date': now.toISOString(),
		},
		now,
	})

	expect(authorization(headers).signedHeaders).toBe(
		'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-upload-date',
	)
	expect(headers['Content-Type']).toBe('image/jpeg')
	expect(headers['X-Amz-Meta-Upload-Date']).toBe('2026-07-29T04:17:00.000Z')
})

test('an undefined header is neither signed nor sent', () => {
	const { headers } = signS3Request({
		credentials,
		method: 'PUT',
		key: 'photo.jpg',
		headers: { 'Content-Type': undefined },
		now,
	})

	expect(authorization(headers).signedHeaders).toBe(
		'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
	)
	expect(headers).not.toHaveProperty('Content-Type')
})

test('query parameters are sorted and encoded the same way in the URL and the signature', () => {
	const { url, headers } = signS3Request({
		credentials,
		method: 'GET',
		key: '',
		query: {
			prefix: 'backups/quartermaster/daily/',
			'list-type': '2',
			'continuation-token': 'a/b+c=',
		},
		now,
	})

	// Sorted by name, every reserved character escaped — S3 recomputes this
	// string from the URL and compares signatures byte for byte.
	expect(url).toBe(
		'https://fly.storage.tigris.dev/quartermaster/' +
			'?continuation-token=a%2Fb%2Bc%3D&list-type=2&prefix=backups%2Fquartermaster%2Fdaily%2F',
	)
	expect(authorization(headers).signature).toMatch(/^Signature=[0-9a-f]{64}$/)
})

test('the signature is stable for identical requests and moves with the key', () => {
	const sign = (key: string) =>
		authorization(
			signS3Request({ credentials, method: 'GET', key, now }).headers,
		).signature

	expect(sign('a.jpg')).toBe(sign('a.jpg'))
	expect(sign('a.jpg')).not.toBe(sign('b.jpg'))
})

test('missing configuration is reported by name rather than signed with undefined', () => {
	expect(() =>
		getS3CredentialsFromEnv({
			AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
			AWS_REGION: 'auto',
		}),
	).toThrow(/bucket, accessKeyId, secretAccessKey/)
})
