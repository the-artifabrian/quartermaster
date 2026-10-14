import fs from 'node:fs'
import path from 'node:path'
import { type RequestHandler } from 'express'

const twins = { br: '.br', gzip: '.gz' } as const
const encodings = Object.keys(twins) as Array<keyof typeof twins>

/**
 * Rewrites a GET or HEAD for an asset to its stored .br or .gz twin when the
 * client accepts that encoding and the build wrote one
 * (scripts/precompress-assets.ts), and sets the headers the twin needs;
 * express.static then sends the file. Assets are hashed and immutable, so the
 * directory is read once at startup. A missing directory means no twins, and
 * the static handler answers as it always did.
 */
export function servePrecompressed(directory: string): RequestHandler {
	const files = new Set(
		fs.existsSync(directory) ? fs.readdirSync(directory) : [],
	)
	return (req, res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()
		const name = req.path.slice(1)
		// Browsers list gzip before br without weights, so br is asked first.
		const encoding = encodings.find((candidate) =>
			req.acceptsEncodings(candidate),
		)
		if (!encoding || !files.has(name + twins[encoding])) return next()
		res.set('Content-Encoding', encoding)
		res.vary('Accept-Encoding')
		res.type(path.extname(name))
		req.url = `/${name}${twins[encoding]}`
		next()
	}
}
