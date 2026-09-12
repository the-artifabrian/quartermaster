import { type FileUpload } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import {
	getS3CredentialsFromEnv,
	signS3Request,
} from '#app/utils/s3-request.server.ts'

async function uploadToStorage(
	file: File | FileUpload,
	key: string,
	signal?: AbortSignal,
) {
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
	return deleteFromStorage(objectKey)
}

export async function uploadNoteImage(
	userId: string,
	noteId: string,
	file: File | FileUpload,
) {
	const fileId = createId()
	const fileExtension = file.name.split('.').pop() || ''
	const timestamp = Date.now()
	const key = `users/${userId}/notes/${noteId}/images/${timestamp}-${fileId}.${fileExtension}`
	return uploadToStorage(file, key)
}

export async function uploadRecipeImage(
	userId: string,
	recipeId: string,
	file: File | FileUpload,
) {
	const fileId = createId()
	const fileExtension = file.name.split('.').pop() || ''
	const timestamp = Date.now()
	const key = `users/${userId}/recipes/${recipeId}/images/${timestamp}-${fileId}.${fileExtension}`
	return uploadToStorage(file, key)
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
	const key = `users/${userId}/recipes/${recipeId}/images/${createId()}-${file.name}`
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
