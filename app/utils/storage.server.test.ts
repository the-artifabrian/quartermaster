// The image route serves only keys of the shape the storage writers produce,
// so a writer that strays breaks the photo.
import fs from 'node:fs/promises'
import path from 'node:path'
import { delay, http } from 'msw'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { isRecipeImageKey } from './image-route.ts'
import { checkRecipePhoto } from './recipe-photo.server.ts'
import { copyRecipeImage, uploadRecipeImage } from './storage.server.ts'
import { server } from '#tests/setup/mocks-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const USER = 'storage-test-user'

afterEach(async () => {
	await fs.rm(path.join(UPLOADS_DIR, 'users', USER), {
		recursive: true,
		force: true,
	})
})

const solid = () =>
	sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })

async function checkedPhoto(name: string, type: string, bytes?: Buffer) {
	const part = new Uint8Array(bytes ?? (await solid().png().toBuffer()))
	const file = new File([part], name, { type })
	const result = await checkRecipePhoto(file)
	if (!result.ok) throw new Error('The fixture photo should pass the check')
	return result.photo
}

// An upload's file name and type come from the browser or a hand-made request.
// The key takes nothing from the name, and its extension follows the bytes.
test.each([
	['no dot', 'photo', 'image/jpeg', 'jpeg', '.jpg'],
	['a space after the dot', 'photo.j pg', 'image/jpeg', 'jpeg', '.jpg'],
	['a slash after the dot', 'photo./../../evil', 'image/png', 'png', '.png'],
	[
		'an extension that is not its type',
		'photo.JPG',
		'image/jpeg',
		'webp',
		'.webp',
	],
] as const)(
	'stores an upload whose name has %s under a key the image route serves',
	async (_, name, type, format, extension) => {
		const bytes = await solid().toFormat(format).toBuffer()
		const photo = await checkedPhoto(name, type, bytes)
		const key = await uploadRecipeImage(USER, 'recipe-1', photo)
		expect(isRecipeImageKey(key)).toBe(true)
		expect(key.startsWith(`users/${USER}/recipes/recipe-1/images/`)).toBe(true)
		expect(key.endsWith(extension)).toBe(true)
		await expect(fs.stat(path.join(UPLOADS_DIR, key))).resolves.toBeTruthy()
	},
)

// A copy names itself after its source.
test('keeps a copy of a copy the same shape and length as an upload', async () => {
	const photo = await checkedPhoto('photo.png', 'image/png')
	const upload = await uploadRecipeImage(USER, 'recipe-1', photo)
	const copy = await copyRecipeImage(upload, USER, 'recipe-2')
	const copyOfCopy = await copyRecipeImage(copy, USER, 'recipe-3')
	for (const key of [copy, copyOfCopy]) {
		expect(isRecipeImageKey(key)).toBe(true)
		expect(key.endsWith('.png')).toBe(true)
	}
	expect(path.basename(copyOfCopy)).toHaveLength(path.basename(upload).length)
})

// Stopping the write keeps any page from being left with an object it can't
// show.
test('refuses to store under an id that would break the key shape', async () => {
	const photo = await checkedPhoto('photo.png', 'image/png')
	const badUser = `${USER} 2`
	try {
		await expect(uploadRecipeImage(badUser, 'r1', photo)).rejects.toThrow()
		await expect(
			fs.stat(path.join(UPLOADS_DIR, 'users', badUser)),
		).rejects.toThrow()
	} finally {
		await fs.rm(path.join(UPLOADS_DIR, 'users', badUser), {
			recursive: true,
			force: true,
		})
	}
})

// A hung upload would stop the hourly demo template build for good, since
// maintenance skips a run while the last one is still going.
test('gives up on an upload that storage never answers', async () => {
	const photo = await checkedPhoto('photo.png', 'image/png')
	server.use(http.put('*', () => delay('infinite')))
	// The real limit is 30 seconds; a short one stands in for it.
	const timeout = AbortSignal.timeout.bind(AbortSignal)
	const spy = vi
		.spyOn(AbortSignal, 'timeout')
		.mockImplementation(() => timeout(50))
	try {
		await expect(uploadRecipeImage(USER, 'recipe-1', photo)).rejects.toThrow()
		expect(spy).toHaveBeenCalledWith(30_000)
	} finally {
		spy.mockRestore()
	}
}, 5_000)
