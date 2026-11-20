// Failure list for the keys the storage writers produce (the image route
// serves only keys of this shape, so a writer that strays breaks the photo):
// - an upload's file name is the browser's (or a hand-made request's), so it
//   can have no dot, a space, a slash or anything else after its last dot;
//   the key must not carry any of that
// - a copy names itself after its source, so a copy of a copy must not grow
//   the key until it no longer fits
// - an id that would break the shape must stop the write, not store an
//   object no page can show
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { isRecipeImageKey } from './image-route.ts'
import { copyRecipeImage, uploadRecipeImage } from './storage.server.ts'
import '#tests/setup/mocks-setup.ts'

const UPLOADS_DIR = path.join(process.cwd(), 'tests/fixtures/uploaded')
const USER = 'storage-test-user'

afterEach(async () => {
	await fs.rm(path.join(UPLOADS_DIR, 'users', USER), {
		recursive: true,
		force: true,
	})
})

test.each([
	['no dot', 'photo', 'image/jpeg', '.jpg'],
	['a space after the dot', 'photo.j pg', 'image/jpeg', '.jpg'],
	['a slash after the dot', 'photo./../../evil', 'image/png', '.png'],
	['an extension that is not its type', 'photo.JPG', 'image/webp', '.webp'],
])(
	'stores an upload whose name has %s under a key the image route serves',
	async (_, name, type, extension) => {
		const file = new File([Buffer.from('bytes')], name, { type })
		const key = await uploadRecipeImage(USER, 'recipe-1', file)
		expect(isRecipeImageKey(key)).toBe(true)
		expect(key.startsWith(`users/${USER}/recipes/recipe-1/images/`)).toBe(true)
		expect(key.endsWith(extension)).toBe(true)
		await expect(fs.stat(path.join(UPLOADS_DIR, key))).resolves.toBeTruthy()
	},
)

test('keeps a copy of a copy the same shape and length as an upload', async () => {
	const file = new File([Buffer.from('bytes')], 'photo.png', {
		type: 'image/png',
	})
	const upload = await uploadRecipeImage(USER, 'recipe-1', file)
	const copy = await copyRecipeImage(upload, USER, 'recipe-2')
	const copyOfCopy = await copyRecipeImage(copy, USER, 'recipe-3')
	for (const key of [copy, copyOfCopy]) {
		expect(isRecipeImageKey(key)).toBe(true)
		expect(key.endsWith('.png')).toBe(true)
	}
	expect(path.basename(copyOfCopy)).toHaveLength(path.basename(upload).length)
})

test('refuses to store under an id that would break the key shape', async () => {
	const file = new File([Buffer.from('bytes')], 'photo.png', {
		type: 'image/png',
	})
	const badUser = `${USER} 2`
	try {
		await expect(uploadRecipeImage(badUser, 'r1', file)).rejects.toThrow()
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
