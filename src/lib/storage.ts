import { mkdirSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

/**
 * Session-scoped scratch directory for uploaded file bodies.
 *
 * Everything here is deleted when the server stops, so the "files never outlive
 * the session" guarantee still holds — they just live on disk instead of in RAM
 * while the session runs, which is what lets a delete return the space
 * immediately instead of waiting for a garbage collection.
 *
 * Paths are built with os.tmpdir() + path.join throughout, so this resolves to
 * %TEMP% on Windows, /var/folders/... on macOS, and /tmp (or $TMPDIR) on Linux.
 */

const PREFIX = 'localcloud-'

declare global {
  var __dataDir: string | undefined
}

export const dataDir: string = (globalThis.__dataDir ??= initDataDir())

/**
 * Guarantees the scratch directory exists before a write.
 *
 * The system temp folder is not ours alone: systemd-tmpfiles, macOS periodic
 * cleanups, and Windows Storage Sense all delete from it on their own schedule.
 * A server that runs for weeks can find its directory gone, and every upload
 * would fail until a restart. mkdir is a no-op when it is already there.
 */
export function ensureDataDir(): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  return dataDir
}

function initDataDir(): string {
  const dir = join(tmpdir(), `${PREFIX}${process.pid}-${randomUUID().slice(0, 8)}`)

  // 0o700 matters on Linux/macOS, where the system temp directory is shared and
  // world-readable — without it any local user could read transferred files.
  // Windows ignores the mode, but its per-user %TEMP% is already restricted.
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  sweepAbandonedDirs(dir)
  registerCleanup(dir)

  return dir
}

/** Removes scratch directories left behind by runs that crashed or were killed. */
function sweepAbandonedDirs(current: string): void {
  let entries: string[]
  try {
    entries = readdirSync(tmpdir())
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.startsWith(PREFIX)) continue

    const dir = join(tmpdir(), entry)
    if (dir === current) continue

    const pid = Number(entry.slice(PREFIX.length).split('-')[0])
    if (Number.isInteger(pid) && pid > 0 && isRunning(pid)) continue

    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Another instance may be mid-cleanup; leave it for next time.
    }
  }
}

/** Signal 0 performs the permission checks without delivering a signal. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function registerCleanup(dir: string): void {
  let done = false

  const cleanup = () => {
    if (done) return
    done = true
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Nothing useful to do while the process is on its way out.
    }
  }

  process.on('exit', cleanup)

  // SIGBREAK is Windows-only (Ctrl+Break); SIGTERM is not delivered by Windows
  // but is what a Linux/macOS service manager sends. Registering all three keeps
  // one code path across platforms — unknown signals are simply never raised.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.once(signal, () => {
      cleanup()
      // Re-raise with the default handler so exit codes stay conventional.
      process.kill(process.pid, signal)
    })
  }
}
