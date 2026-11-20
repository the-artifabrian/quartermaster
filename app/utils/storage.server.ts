import { type FileUpload } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import { removeCachedResizes } from '#app/utils/image-cache.server.ts'
import { isRecipeImageKey } from '#app/utils/image-route.ts'
import {
	getS3CredentialsFromEnv,
	signS3Request,
} from '#app/utils/s3-request.server.ts'

async function uploadToStorage(
	file: File | FileUpload,
	key: string,
	signal?: AbortSignal,
) {
	// The image route serves only keys of this shape, so storing anything else
	// would leave a photo no page can show.
	if (!isRecipeImageKey(key)) {
		throw new Error(`Refusing to store an image under an unexpected key`)
	}
	const { url, headers } = getSignedPutRequestInfo(file, key)

	const uploadResponse = await fetch(url, {
		method: 'PUT',
		headers,
		body: file instanceof File ? file : (file as FileUpload).stream(),
		signal,
	})

	if (!uploadResponse.ok) {
		const errorMessage = `Failed to upload file to storage. Server responded with ${uploadResponse.status}: ${uploadResponse.statusText}`
		console.error(errorMessage)
		throw new Error(`Failed to upload object: ${key}`)
	}

	return key
}

async function deleteFromStorage(key: string) {
	const { url, headers } = getSignedDeleteRequestInfo(key)

	const deleteResponse = await fetch(url, {
		method: 'DELETE',
		headers,
		signal: AbortSignal.timeout(30_000),
	})

	if (!deleteResponse.ok && deleteResponse.status !== 404) {
		// 404 is ok - object doesn't exist
		const errorMessage = `Failed to delete file from storage. Server responded with ${deleteResponse.status}: ${deleteResponse.statusText}`
		console.error(errorMessage)
		throw new Error(`Failed to delete object: ${key}`)
	}

	return true
}

export async function deleteRecipeImage(objectKey: string) {
	await deleteFromStorage(objectKey)
	// The image route answers from its cache before it asks storage, so the
	// cached resizes have to go too or the photo stays public.
	if (isRecipeImageKey(objectKey)) {
		await removeCachedResizes(objectKey).catch((error: unknown) => {
			console.error('Failed to remove cached resizes of a deleted photo', error)
		})
	}
	return true
}

const EXTENSION_BY_TYPE: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
}

/** `<timestamp>-<id>.<ext>`: nothing from the uploaded file's own name. */
function newImageKey(userId: string, recipeId: string, extension: string) {
	return `users/${userId}/recipes/${recipeId}/images/${Date.now()}-${createId()}.${extension}`
}

export async function uploadRecipeImage(
	userId: string,
	recipeId: string,
	file: File | FileUpload,
) {
	// The browser's file name can hold anything after its last dot, so the
	// extension comes from the type the upload was checked against.
	const extension = EXTENSION_BY_TYPE[file.type] ?? 'img'
	return uploadToStorage(file, newImageKey(userId, recipeId, extension))
}

/** Copy bytes to a recipient-owned key before committing a shared bundle. */
export async function copyRecipeImage(
	objectKey: string,
	userId: string,
	recipeId: string,
) {
	const { url, headers } = getSignedGetRequestInfo(objectKey)
	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(30_000),
	})
	if (!response.ok) throw new Error('Unable to read the shared Recipe image')
	const file = new File(
		[await response.arrayBuffer()],
		objectKey.split('/').pop() || 'image',
		{
			type: response.headers.get('Content-Type') || 'application/octet-stream',
		},
	)
	// A fresh name of the same shape as an upload's.
	const sourceExtension = /\.([A-Za-z0-9]{1,8})$/.exec(objectKey)?.[1]
	const key = newImageKey(
		userId,
		recipeId,
		sourceExtension?.toLowerCase() ?? EXTENSION_BY_TYPE[file.type] ?? 'img',
	)
	try {
		return await uploadToStorage(file, key, AbortSignal.timeout(30_000))
	} catch (error) {
		// A failed response may follow a successful write; this key belongs
		// only to this attempt and is never attached to a saved Recipe yet.
		await deleteFromStorage(key).catch(() => {})
		throw error
	}
}

function getSignedPutRequestInfo(file: File | FileUpload, key: string) {
	return signS3Request({
		credentials: getS3CredentialsFromEnv(),
		method: 'PUT',
		key,
		headers: {
			'Content-Type': file.type || undefined,
			'X-Amz-Meta-Upload-Date': new Date().toISOString(),
		},
	})
}

function getSignedDeleteRequestInfo(key: string) {
	return signS3Request({
		credentials: getS3CredentialsFromEnv(),
		method: 'DELETE',
		key,
	})
}

export function getSignedGetRequestInfo(key: string) {
	return signS3Request({
		credentials: getS3CredentialsFromEnv(),
		method: 'GET',
		key,
	})
}
