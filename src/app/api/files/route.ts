import { NextRequest, NextResponse } from 'next/server'
import { addFile, getAllFiles } from '@/lib/file-store'
import { fileEvents } from '@/lib/events'
import { scheduleCollect } from '@/lib/gc'
import { scheduleEvictionIfIdle } from '@/lib/presence'

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

  let results
  try {
    results = await Promise.all(
      files.map(async (file) => {
        const meta = await addFile({
          name: file.name,
          type: file.type || 'application/octet-stream',
          uploadedAt: new Date().toISOString(),
          uploaderIp: ip,
          body: file.stream(),
        })
        fileEvents.emit('file-added', meta)
        return meta
      }),
    )
  } catch {
    return NextResponse.json({ error: 'Failed to store upload' }, { status: 500 })
  } finally {
    // formData() materialises every uploaded body in memory before it reaches
    // disk. Those buffers are garbage the moment the writes finish, but nothing
    // would collect them for a long time without a nudge.
    scheduleCollect()
    // An upload can arrive with no dashboard open at all (a direct API call),
    // which would otherwise leave the new files with no eviction armed.
    scheduleEvictionIfIdle()
  }

  return NextResponse.json(results, { status: 201 })
}
