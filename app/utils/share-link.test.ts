import { describe, expect, test, vi } from 'vitest'
import { shareOrCopy } from './share-link.ts'

const data = { title: 'Roast carrots', url: 'https://useqm.app/share/abc' }

function rejection(name: string) {
	return new DOMException('share failed', name)
}

describe('shareOrCopy', () => {
	test('copies the link when the browser has no share sheet', async () => {
		const copy = vi.fn().mockResolvedValue(undefined)
		expect(await shareOrCopy({ data, copy })).toBe('copied')
		expect(copy).toHaveBeenCalledWith(data.url)
	})

	test('copies the link without opening the sheet when canShare refuses the payload', async () => {
		const share = vi.fn().mockResolvedValue(undefined)
		const copy = vi.fn().mockResolvedValue(undefined)
		const canShare = vi.fn().mockReturnValue(false)
		expect(await shareOrCopy({ data, share, canShare, copy })).toBe('copied')
		expect(canShare).toHaveBeenCalledWith(data)
		expect(share).not.toHaveBeenCalled()
		expect(copy).toHaveBeenCalledWith(data.url)
	})

	test('opens the sheet with the title and link and copies nothing when it resolves', async () => {
		const share = vi.fn().mockResolvedValue(undefined)
		const copy = vi.fn().mockResolvedValue(undefined)
		const canShare = vi.fn().mockReturnValue(true)
		expect(await shareOrCopy({ data, share, canShare, copy })).toBe('shared')
		expect(share).toHaveBeenCalledWith(data)
		expect(copy).not.toHaveBeenCalled()
	})

	test('stays silent when the person cancels the sheet', async () => {
		const share = vi.fn().mockRejectedValue(rejection('AbortError'))
		const copy = vi.fn().mockResolvedValue(undefined)
		expect(await shareOrCopy({ data, share, copy })).toBe('cancelled')
		expect(copy).not.toHaveBeenCalled()
	})

	test.each(['NotAllowedError', 'InvalidStateError', 'DataError'])(
		'copies the link when the sheet rejects with %s',
		async (name) => {
			const share = vi.fn().mockRejectedValue(rejection(name))
			const copy = vi.fn().mockResolvedValue(undefined)
			expect(await shareOrCopy({ data, share, copy })).toBe('copied')
			expect(copy).toHaveBeenCalledWith(data.url)
		},
	)

	test('copies the link when the sheet rejects with something that is not an error', async () => {
		const share = vi.fn().mockRejectedValue(undefined)
		const copy = vi.fn().mockResolvedValue(undefined)
		expect(await shareOrCopy({ data, share, copy })).toBe('copied')
	})

	test('reports a failed copy when there is no sheet and the clipboard refuses', async () => {
		const copy = vi.fn().mockRejectedValue(rejection('NotAllowedError'))
		expect(await shareOrCopy({ data, copy })).toBe('copy-failed')
	})

	test('reports a failed copy when the sheet fails and the clipboard refuses too', async () => {
		const share = vi.fn().mockRejectedValue(rejection('NotAllowedError'))
		const copy = vi.fn().mockRejectedValue(rejection('NotAllowedError'))
		expect(await shareOrCopy({ data, share, copy })).toBe('copy-failed')
	})
})
