import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeReadableStream } from 'stream/web'
import { dataDir, ensureDataDir } from './storage'
import type { FileMetadata } from './types'

export interface StoredFile extends FileMetadata {
  path: string
}

export interface NewFile {
  name: string
  type: string
  uploadedAt: string
  uploaderIp: string
  body: ReadableStream<Uint8Array>
}

declare global {
  var __fileStore: Map<string, StoredFile> | undefined
  var __pendingUnlink: Set<string> | undefined
}

const store: Map<string, StoredFile> = (globalThis.__fileStore ??= new Map())

/** Paths whose unlink lost a race with an open handle; retried opportunistically. */
const pendingUnlink: Set<string> = (globalThis.__pendingUnlink ??= new Set())

export async function addFile(file: NewFile): Promise<FileMetadata> {
  const id = randomUUID()

  // The on-disk name is the id alone — never the uploaded filename. Nothing has
  // to be escaped for the host filesystem, names can't collide, and paths stay
  // well clear of the Windows 260-character limit.
  const path = join(dataDir, id)

  ensureDataDir()

  try {
    await pipeline(
      Readable.fromWeb(file.body as NodeReadableStream<Uint8Array>),
      createWriteStream(path, { mode: 0o600 }),
    )
  } catch (err) {
    await rm(path, { force: true }).catch(() => {})
    throw err
  }

  // Trust the bytes that landed, not any advertised length.
  const { size } = await stat(path)

  const meta: FileMetadata = {
    id,
    name: file.name,
    size,
    type: file.type,
    uploadedAt: file.uploadedAt,
    uploaderIp: file.uploaderIp,
  }

  store.set(id, { ...meta, path })
  return meta
}

export function getFile(id: string): StoredFile | undefined {
  return store.get(id)
}

export function getAllFiles(): FileMetadata[] {
  return getAllStoredFiles().map(toMetadata)
}

export function getAllStoredFiles(): StoredFile[] {
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  )
}

export async function deleteFile(id: string): Promise<boolean> {
  const file = store.get(id)
  if (!file) return false

  store.delete(id)
  await removeFromDisk(file.path)
  void sweepPendingUnlinks()

  return true
}

/** Empties the store, returning the ids that were removed. */
export async function clearAllFiles(): Promise<string[]> {
  const files = Array.from(store.values())
  if (!files.length) return []

  store.clear()
  for (const file of files) await removeFromDisk(file.path)
  void sweepPendingUnlinks()

  return files.map((file) => file.id)
}

async function removeFromDisk(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
    pendingUnlink.delete(path)
  } catch {
    // Windows can refuse to unlink a file that an in-flight download still has
    // open. The entry is already gone from the store, so retry the disk side
    // later rather than failing the request.
    pendingUnlink.add(path)
  }
}

async function sweepPendingUnlinks(): Promise<void> {
  for (const path of pendingUnlink) {
    try {
      await rm(path, { force: true })
      pendingUnlink.delete(path)
    } catch {
      // Still held; try again on the next delete, and the scratch directory is
      // removed wholesale at shutdown regardless.
    }
  }
}

function toMetadata({ path: _path, ...meta }: StoredFile): FileMetadata {
  return meta
}
