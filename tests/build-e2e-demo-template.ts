/**
 * Builds the demo template in the e2e database before the server starts, so
 * a test that starts a demo never races the server's own startup build. The
 * photos are tiny generated ones written to DEMO_PHOTO_DIR; the server gets
 * the same variable, finds the template current and leaves it alone.
 *
 * Uploads go to the mock bucket (tests/fixtures/uploaded), which the server
 * reads in mocks mode. With DEMO_TEMPLATE_OWNER_FILE set, the template
 * owner's id is written there, so scripts/e2e.sh can remove those uploads
 * when the run ends.
 */
import fs from 'node:fs/promises'
import '#tests/mocks/index.ts'
import { prisma } from '#app/utils/db.server.ts'
import { ensureDemoTemplate } from '#app/utils/demo.server.ts'
import { writeTinyDemoPhotos } from '#tests/demo-photos.ts'

const photoDir = process.env.DEMO_PHOTO_DIR
if (!photoDir) {
	console.error('Set DEMO_PHOTO_DIR, and give the server the same one.')
	process.exit(1)
}

try {
	await writeTinyDemoPhotos(photoDir)
	const result = await ensureDemoTemplate(prisma, { photoDir })
	console.log(`Demo template: ${result.status}`)
	const ownerFile = process.env.DEMO_TEMPLATE_OWNER_FILE
	if (ownerFile) await fs.writeFile(ownerFile, result.userId)
} finally {
	await prisma.$disconnect()
}
process.exit(0)
