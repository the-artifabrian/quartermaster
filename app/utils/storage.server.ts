import { type FileUpload } from '@mjackson/form-data-parser'
import { createId } from '@paralleldrive/cuid2'
import {
	getS3CredentialsFromEnv,
	signS3Request,
} from '#app/utils/s3-request.server.ts'

async function uploadToStorage(file: File | FileUpload, key: string) {
	const { url, headers } = getSignedPutRequestInfo(file, key)

	const uploadResponse = await fetch(url, {
		method: 'PUT',
		headers,
		body: file instanceof File ? file : (file as FileUpload).stream(),
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
