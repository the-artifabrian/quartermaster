/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { type DecodeImage, useFitFileInput } from './downscale-image.ts'

const MB = 1024 * 1024

/** jsdom has no DataTransfer; this one only collects files. */
class FakeDataTransfer {
	files: File[] = []
	items = { add: (file: File) => this.files.push(file) }
}
vi.stubGlobal('DataTransfer', FakeDataTransfer)

function fileInput(files: File[]) {
	const input = document.createElement('input')
	input.type = 'file'
	Object.defineProperty(input, 'files', { value: files, writable: true })
	return input
}

function choose(input: HTMLInputElement, files: File[]) {
	input.files = files as unknown as FileList
}

const photo = (name: string, bytes = 5 * MB) =>
	new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' })

/** A decoder that waits until the test releases each decode by file name. */
function heldDecoder() {
	const releases = new Map<string, () => void>()
	const decode: DecodeImage = (file) =>
		new Promise((resolve) => {
			releases.set((file as File).name, () =>
				resolve({
					width: 100,
					height: 100,
					toJpeg: async () =>
						new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
					close() {},
				}),
			)
		})
	return {
		decode,
		release: async (name: string) => {
			await act(async () => releases.get(name)!())
		},
	}
}

test('a later pick wins when an earlier one finishes last', async () => {
	const { decode, release } = heldDecoder()
	const { result } = renderHook(() => useFitFileInput(3 * MB, decode))
	const input = fileInput([photo('first.jpg')])

	let first!: Promise<boolean>
	let second!: Promise<boolean>
	act(() => {
		first = result.current.fit(input)
	})
	choose(input, [photo('second.jpg')])
	act(() => {
		second = result.current.fit(input)
	})
	await release('second.jpg')
	expect(await second).toBe(true)
	await release('first.jpg')
	expect(await first).toBe(false)

	expect(Array.from(input.files!).map((file) => file.name)).toEqual([
		'second.jpg',
	])
})

test('stays busy until the latest pick is ready, even when an earlier one finishes first', async () => {
	const { decode, release } = heldDecoder()
	const { result } = renderHook(() => useFitFileInput(3 * MB, decode))
	const input = fileInput([photo('first.jpg')])

	act(() => {
		void result.current.fit(input)
	})
	choose(input, [photo('second.jpg')])
	act(() => {
		void result.current.fit(input)
	})
	await release('first.jpg')
	expect(result.current.preparing).toBe(true)

	await release('second.jpg')
	expect(result.current.preparing).toBe(false)
})

test('leaves a photo that already fits on the input', async () => {
	const { decode } = heldDecoder()
	const { result } = renderHook(() => useFitFileInput(3 * MB, decode))
	const small = photo('small.jpg', MB)
	const input = fileInput([small])

	let fitted!: boolean
	await act(async () => {
		fitted = await result.current.fit(input)
	})

	expect(fitted).toBe(true)
	expect(input.files![0]).toBe(small)
	expect(result.current.preparing).toBe(false)
})
