// Disposable, local-only comparison. No app server, credentials, or database.
const root = import.meta.dir
const build = await Bun.build({
	entrypoints: [`${root}/ui.ts`],
	target: 'browser',
})
if (!build.success) throw new Error(String(build.logs))
Bun.serve({
	hostname: '127.0.0.1',
	port: 9251,
	fetch(request) {
		const path = new URL(request.url).pathname
		if (path === '/ui.js')
			return new Response(build.outputs[0], {
				headers: { 'Content-Type': 'text/javascript' },
			})
		if (path === '/') return new Response(Bun.file(`${root}/index.html`))
		return new Response('Not found', { status: 404 })
	},
})
console.log('Disposable chooser: http://127.0.0.1:9251/?variant=A')
