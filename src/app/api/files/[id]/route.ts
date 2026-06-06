import { NextRequest, NextResponse } from 'next/server'
import { getFile, deleteFile } from '@/lib/file-store'
import { fileEvents } from '@/lib/events'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/files/[id]'>) {
  const { id } = await ctx.params
  const file = getFile(id)

  if (!file) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const safeName = file.name.replace(/[^\x20-\x7E]/g, '_')
  const encodedName = encodeURIComponent(file.name)

  return new Response(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': file.type,
      'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': file.size.toString(),
      'Cache-Control': 'no-store',
    },
  })
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/files/[id]'>) {
  const { id } = await ctx.params
  const deleted = deleteFile(id)

  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  fileEvents.emit('file-removed', id)
  return new Response(null, { status: 204 })
}
