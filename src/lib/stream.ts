import { createReadStream } from 'fs'
import { Readable } from 'stream'

const CHUNK_SIZE = 1024 * 1024

/**
 * Streams a stored file off disk.
 *
 * Handing a whole body to `new Response()` makes the runtime hold two further
 * copies of it for as long as the response is alive — a 500 MB download would
 * sit at 1.5 GB resident until the client finished. Streaming keeps a download
 * flat at one chunk regardless of file size.
 */
export function fileStream(path: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(path, { highWaterMark: CHUNK_SIZE }),
  ) as ReadableStream<Uint8Array>
}
