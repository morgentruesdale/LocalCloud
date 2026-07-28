import { randomUUID } from 'crypto'
import type { FileMetadata } from './types'

export interface StoredFile extends FileMetadata {
  buffer: Buffer
}

declare global {
  var __fileStore: Map<string, StoredFile> | undefined
}

const store: Map<string, StoredFile> = (globalThis.__fileStore ??= new Map())

export function addFile(file: Omit<StoredFile, 'id'>): FileMetadata {
  const id = randomUUID()
  store.set(id, { ...file, id })
  return toMetadata({ ...file, id })
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

export function deleteFile(id: string): boolean {
  return store.delete(id)
}

function toMetadata({ buffer: _buf, ...meta }: StoredFile): FileMetadata {
  return meta
}
