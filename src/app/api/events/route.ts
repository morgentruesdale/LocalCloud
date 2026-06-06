import { fileEvents } from '@/lib/events'
import { getAllFiles } from '@/lib/file-store'
import type { FileMetadata } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          cleanup?.()
        }
      }

      const onAdded = (file: FileMetadata) => send('file-added', file)
      const onRemoved = (id: string) => send('file-removed', { id })

      fileEvents.on('file-added', onAdded)
      fileEvents.on('file-removed', onRemoved)

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:ping\n\n`))
        } catch {
          clearInterval(heartbeat)
          cleanup?.()
        }
      }, 15000)

      cleanup = () => {
        clearInterval(heartbeat)
        fileEvents.off('file-added', onAdded)
        fileEvents.off('file-removed', onRemoved)
      }

      send('init', getAllFiles())
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
