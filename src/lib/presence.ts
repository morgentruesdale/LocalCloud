import { fileEvents } from './events'
import { clearAllFiles } from './file-store'

/**
 * Tracks how many devices are currently connected and clears the store once
 * they have all been gone for a while.
 *
 * The SSE stream in /api/events is the signal: a device holds one open while
 * its dashboard is on screen, so the connection count is the device count.
 * Eviction is scheduled when that count reaches zero and cancelled the moment
 * anyone comes back, which is what makes the delay a grace period rather than a
 * countdown — closing a tab to walk to another room must not cost you the files.
 */

const DEFAULT_MINUTES = 10

const configured = Number(process.env.IDLE_EVICT_MINUTES ?? DEFAULT_MINUTES)
const idleMinutes = Number.isFinite(configured) && configured > 0 ? configured : 0

/** 0 disables idle eviction entirely. */
export const IDLE_EVICT_MS = idleMinutes * 60_000

interface Presence {
  connections: number
  timer: NodeJS.Timeout | null
}

declare global {
  var __presence: Presence | undefined
}

const state: Presence = (globalThis.__presence ??= { connections: 0, timer: null })

/** Registers a connected device. The returned release is safe to call twice. */
export function connectionOpened(): () => void {
  state.connections++
  cancelEviction()

  let released = false
  return () => {
    if (released) return
    released = true
    state.connections = Math.max(0, state.connections - 1)
    scheduleEvictionIfIdle()
  }
}

export function connectionCount(): number {
  return state.connections
}

/**
 * Arms the eviction timer if nobody is connected. Safe to call from anywhere
 * that changes the picture — a disconnect, or an upload that arrived while no
 * dashboard was open (a direct API upload, say).
 */
export function scheduleEvictionIfIdle(): void {
  if (!IDLE_EVICT_MS) return

  if (state.connections > 0) {
    cancelEviction()
    return
  }

  if (state.timer) return

  const timer = setTimeout(() => {
    state.timer = null
    void evict()
  }, IDLE_EVICT_MS)

  // The HTTP server keeps the process alive; this timer should never be the
  // reason it stays up.
  timer.unref()
  state.timer = timer
}

function cancelEviction(): void {
  if (!state.timer) return
  clearTimeout(state.timer)
  state.timer = null
}

async function evict(): Promise<void> {
  // A device may have reconnected between the timer firing and this running.
  if (state.connections > 0) return

  try {
    const ids = await clearAllFiles()
    if (!ids.length) return

    for (const id of ids) fileEvents.emit('file-removed', id)
    console.log(
      `[localcloud] evicted ${ids.length} file(s) after ${idleMinutes} minutes with no devices connected`,
    )
  } catch (err) {
    console.error('[localcloud] idle eviction failed:', err)
  }
}
