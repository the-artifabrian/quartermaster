import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import '#app/utils/env.server.ts'

export const BASE_DATABASE_PATH = path.join(
	process.cwd(),
	`./tests/prisma/base.db`,
)

async function pathExists(target: string) {
	try {
		await fs.access(target)
		return true
	} catch {
		return false
	}
}

function run(
	cmd: string,
	args: Array<string>,
	opts: { env?: NodeJS.ProcessEnv },
) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: 'inherit', env: opts.env })
		child.once('error', reject)
		child.once('exit', (code) => {
			if (code === 0) resolve()
			else reject(new Error(`${cmd} exited with code ${code}`))
		})
	})
}

export async function setup() {
	if (await pathExists(BASE_DATABASE_PATH)) {
		const databaseLastModifiedAt = (await fs.stat(BASE_DATABASE_PATH)).mtime
		const prismaSchemaLastModifiedAt = (await fs.stat('./prisma/schema.prisma'))
			.mtime

		if (prismaSchemaLastModifiedAt < databaseLastModifiedAt) {
			return
		}
	}

	await run(
		'bunx',
		['prisma', 'migrate', 'reset', '--force'],
		{
			env: {
				...process.env,
				DATABASE_URL: `file:${BASE_DATABASE_PATH}`,
			},
		},
	)
}
