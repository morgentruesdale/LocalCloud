import { NextResponse } from 'next/server'
import { getAllStoredFiles } from '@/lib/file-store'
import { createZipStream } from '@/lib/zip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const files = getAllStoredFiles()

  if (!files.length) {
    return NextResponse.json({ error: 'No files to download' }, { status: 404 })
  }

  const { stream, size } = createZipStream(files)

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveName()}"`,
      'Content-Length': size.toString(),
      'Cache-Control': 'no-store',
    },
  })
}

function archiveName(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `localcloud-${stamp}.zip`
}
