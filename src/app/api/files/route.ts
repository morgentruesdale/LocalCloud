import { NextRequest, NextResponse } from 'next/server'
import { addFile, getAllFiles } from '@/lib/file-store'
import { fileEvents } from '@/lib/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = parseInt(process.env.MAX_FILE_SIZE_MB ?? '500') * 1024 * 1024

function formatMB(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export async function GET() {
  return NextResponse.json(getAllFiles())
}

export async function POST(request: NextRequest) {
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_BYTES) {
    return NextResponse.json(
      { error: `Upload too large. Maximum file size is ${formatMB(MAX_BYTES)}.` },
      { status: 413 },
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const rawFiles = formData.getAll('files')
  const files = rawFiles.filter((f): f is File => f instanceof File && f.size > 0)

  if (!files.length) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  const oversized = files.find((f) => f.size > MAX_BYTES)
  if (oversized) {
    return NextResponse.json(
      { error: `"${oversized.name}" exceeds the ${formatMB(MAX_BYTES)} limit.` },
      { status: 413 },
    )
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer())
      const meta = addFile({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        buffer,
        uploadedAt: new Date().toISOString(),
        uploaderIp: ip,
      })
      fileEvents.emit('file-added', meta)
      return meta
    }),
  )

  return NextResponse.json(results, { status: 201 })
}
