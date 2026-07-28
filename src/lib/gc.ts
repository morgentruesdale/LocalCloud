/**
 * Requests a garbage collection, debounced.
 *
 * Uploaded bodies are parsed into memory before they reach disk, and V8 will not
 * reclaim those buffers on its own for a long time: the bytes live outside its
 * heap, so a few hundred MB of garbage creates no heap pressure and triggers no
 * collection. On an idle server that memory just sits in RSS.
 *
 * A no-op unless the process was started with --expose-gc, which the packaged
 * start scripts do. A full collection pauses the process, so callers only hint
 * after large transient allocations, never per request.
 */

const DEBOUNCE_MS = 2000

declare global {
  var __gcTimer: NodeJS.Timeout | null | undefined
}

export function scheduleCollect(): void {
  const collect = (globalThis as { gc?: () => void }).gc
  if (typeof collect !== 'function') return
  if (globalThis.__gcTimer) return

  const timer = setTimeout(() => {
    globalThis.__gcTimer = null
    collect()
  }, DEBOUNCE_MS)

  // Never hold the event loop open just to run a collection.
  timer.unref()
  globalThis.__gcTimer = timer
}
