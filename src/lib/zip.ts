import * as zlib from 'zlib'
import type { StoredFile } from './file-store'

/**
 * Minimal ZIP writer for the in-memory file store.
 *
 * Entries are stored uncompressed (method 0) because most transferred files are
 * already compressed and the LAN is faster than the CPU would be. Storing also
 * means every size is known before a byte is written, so the response can carry
 * a real Content-Length and browsers show accurate download progress.
 *
 * ZIP64 records are emitted only when an entry, an offset, or the archive
 * exceeds the 32-bit limits.
 */

const U16_MAX = 0xffff
const U32_MAX = 0xffffffff

const LOCAL_HEADER = 30
const CENTRAL_HEADER = 46
const EOCD = 22
const ZIP64_EOCD = 56
const ZIP64_LOCATOR = 20

const CHUNK_SIZE = 1024 * 1024

interface Entry {
  nameBytes: Buffer
  buffer: Buffer
  size: number
  dosTime: number
  dosDate: number
  offset: number
  localZip64: boolean
  centralZip64: boolean
  crc: number
}

interface Plan {
  entries: Entry[]
  cdOffset: number
  cdSize: number
  zip64: boolean
  totalSize: number
}

export function createZipStream(files: StoredFile[]): {
  stream: ReadableStream<Uint8Array>
  size: number
} {
  const plan = planArchive(files)
  const chunks = zipChunks(plan)

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const { value, done } = chunks.next()
      if (done) {
        controller.close()
      } else {
        controller.enqueue(value)
      }
    },
  })

  return { stream, size: plan.totalSize }
}

function planArchive(files: StoredFile[]): Plan {
  const used = new Set<string>()
  const entries: Entry[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(uniqueName(safeName(file.name), used), 'utf8')
    const size = file.buffer.length
    const localZip64 = size >= U32_MAX
    const { time, date } = dosDateTime(file.uploadedAt)

    entries.push({
      nameBytes,
      buffer: file.buffer,
      size,
      dosTime: time,
      dosDate: date,
      offset,
      localZip64,
      centralZip64: false,
      crc: 0,
    })

    offset += LOCAL_HEADER + nameBytes.length + (localZip64 ? 20 : 0) + size
  }

  const cdOffset = offset
  let cdSize = 0
  let zip64 = entries.length > U16_MAX || cdOffset >= U32_MAX

  for (const entry of entries) {
    entry.centralZip64 = entry.size >= U32_MAX || entry.offset >= U32_MAX
    cdSize += CENTRAL_HEADER + entry.nameBytes.length + centralExtraSize(entry)
    if (entry.centralZip64) zip64 = true
  }

  if (cdSize >= U32_MAX) zip64 = true

  const totalSize = cdOffset + cdSize + (zip64 ? ZIP64_EOCD + ZIP64_LOCATOR : 0) + EOCD

  return { entries, cdOffset, cdSize, zip64, totalSize }
}

function* zipChunks(plan: Plan): Generator<Uint8Array> {
  for (const entry of plan.entries) {
    entry.crc = crc32(entry.buffer)
    yield localHeader(entry)
    for (let i = 0; i < entry.size; i += CHUNK_SIZE) {
      yield entry.buffer.subarray(i, Math.min(i + CHUNK_SIZE, entry.size))
    }
  }

  for (const entry of plan.entries) {
    yield centralHeader(entry)
  }

  if (plan.zip64) {
    yield zip64EndRecord(plan)
    yield zip64Locator(plan)
  }

  yield endRecord(plan)
}

function localHeader(entry: Entry): Buffer {
  const extraSize = entry.localZip64 ? 20 : 0
  const buf = Buffer.alloc(LOCAL_HEADER + entry.nameBytes.length + extraSize)

  buf.writeUInt32LE(0x04034b50, 0)
  buf.writeUInt16LE(entry.localZip64 ? 45 : 20, 4) // version needed
  buf.writeUInt16LE(0x0800, 6) // flags: UTF-8 filename
  buf.writeUInt16LE(0, 8) // method: stored
  buf.writeUInt16LE(entry.dosTime, 10)
  buf.writeUInt16LE(entry.dosDate, 12)
  buf.writeUInt32LE(entry.crc, 14)
  buf.writeUInt32LE(entry.localZip64 ? U32_MAX : entry.size, 18) // compressed
  buf.writeUInt32LE(entry.localZip64 ? U32_MAX : entry.size, 22) // uncompressed
  buf.writeUInt16LE(entry.nameBytes.length, 26)
  buf.writeUInt16LE(extraSize, 28)
  entry.nameBytes.copy(buf, LOCAL_HEADER)

  if (entry.localZip64) {
    const at = LOCAL_HEADER + entry.nameBytes.length
    buf.writeUInt16LE(0x0001, at)
    buf.writeUInt16LE(16, at + 2)
    buf.writeBigUInt64LE(BigInt(entry.size), at + 4)
    buf.writeBigUInt64LE(BigInt(entry.size), at + 12)
  }

  return buf
}

function centralHeader(entry: Entry): Buffer {
  const extraSize = centralExtraSize(entry)
  const buf = Buffer.alloc(CENTRAL_HEADER + entry.nameBytes.length + extraSize)
  const sizesInExtra = entry.size >= U32_MAX
  const offsetInExtra = entry.offset >= U32_MAX

  buf.writeUInt32LE(0x02014b50, 0)
  buf.writeUInt16LE(entry.centralZip64 ? 45 : 20, 4) // version made by
  buf.writeUInt16LE(entry.centralZip64 ? 45 : 20, 6) // version needed
  buf.writeUInt16LE(0x0800, 8) // flags: UTF-8 filename
  buf.writeUInt16LE(0, 10) // method: stored
  buf.writeUInt16LE(entry.dosTime, 12)
  buf.writeUInt16LE(entry.dosDate, 14)
  buf.writeUInt32LE(entry.crc, 16)
  buf.writeUInt32LE(sizesInExtra ? U32_MAX : entry.size, 20) // compressed
  buf.writeUInt32LE(sizesInExtra ? U32_MAX : entry.size, 24) // uncompressed
  buf.writeUInt16LE(entry.nameBytes.length, 28)
  buf.writeUInt16LE(extraSize, 30)
  buf.writeUInt16LE(0, 32) // comment length
  buf.writeUInt16LE(0, 34) // disk number start
  buf.writeUInt16LE(0, 36) // internal attributes
  buf.writeUInt32LE(0, 38) // external attributes
  buf.writeUInt32LE(offsetInExtra ? U32_MAX : entry.offset, 42)
  entry.nameBytes.copy(buf, CENTRAL_HEADER)

  if (extraSize) {
    // ZIP64 extra fields appear in a fixed order, and only for the fixed
    // fields that were replaced by a 0xffffffff sentinel above.
    let at = CENTRAL_HEADER + entry.nameBytes.length
    buf.writeUInt16LE(0x0001, at)
    buf.writeUInt16LE(extraSize - 4, at + 2)
    at += 4
    if (sizesInExtra) {
      buf.writeBigUInt64LE(BigInt(entry.size), at)
      buf.writeBigUInt64LE(BigInt(entry.size), at + 8)
      at += 16
    }
    if (offsetInExtra) {
      buf.writeBigUInt64LE(BigInt(entry.offset), at)
    }
  }

  return buf
}

function centralExtraSize(entry: Entry): number {
  if (!entry.centralZip64) return 0
  return 4 + (entry.size >= U32_MAX ? 16 : 0) + (entry.offset >= U32_MAX ? 8 : 0)
}

function zip64EndRecord(plan: Plan): Buffer {
  const buf = Buffer.alloc(ZIP64_EOCD)
  const count = BigInt(plan.entries.length)

  buf.writeUInt32LE(0x06064b50, 0)
  buf.writeBigUInt64LE(BigInt(ZIP64_EOCD - 12), 4) // size of the rest of this record
  buf.writeUInt16LE(45, 12) // version made by
  buf.writeUInt16LE(45, 14) // version needed
  buf.writeUInt32LE(0, 16) // this disk
  buf.writeUInt32LE(0, 20) // disk with central directory
  buf.writeBigUInt64LE(count, 24)
  buf.writeBigUInt64LE(count, 32)
  buf.writeBigUInt64LE(BigInt(plan.cdSize), 40)
  buf.writeBigUInt64LE(BigInt(plan.cdOffset), 48)

  return buf
}

function zip64Locator(plan: Plan): Buffer {
  const buf = Buffer.alloc(ZIP64_LOCATOR)

  buf.writeUInt32LE(0x07064b50, 0)
  buf.writeUInt32LE(0, 4) // disk with the ZIP64 end record
  buf.writeBigUInt64LE(BigInt(plan.cdOffset + plan.cdSize), 8)
  buf.writeUInt32LE(1, 16) // total disks

  return buf
}

function endRecord(plan: Plan): Buffer {
  const buf = Buffer.alloc(EOCD)
  const count = Math.min(plan.entries.length, U16_MAX)

  buf.writeUInt32LE(0x06054b50, 0)
  buf.writeUInt16LE(0, 4) // this disk
  buf.writeUInt16LE(0, 6) // disk with central directory
  buf.writeUInt16LE(count, 8)
  buf.writeUInt16LE(count, 10)
  buf.writeUInt32LE(Math.min(plan.cdSize, U32_MAX), 12)
  buf.writeUInt32LE(Math.min(plan.cdOffset, U32_MAX), 16)
  buf.writeUInt16LE(0, 20) // comment length

  return buf
}

/** Flattens any path and strips characters that break extraction on Windows. */
function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/[\x00-\x1f\x7f:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+$/, '')
  return cleaned || 'file'
}

/** Extractors overwrite duplicates silently, so make every entry name unique. */
function uniqueName(name: string, used: Set<string>): string {
  const key = name.toLowerCase()
  if (!used.has(key)) {
    used.add(key)
    return name
  }

  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''

  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    const candidateKey = candidate.toLowerCase()
    if (!used.has(candidateKey)) {
      used.add(candidateKey)
      return candidate
    }
  }
}

function dosDateTime(iso: string): { time: number; date: number } {
  const parsed = new Date(iso)
  const d = isNaN(parsed.getTime()) ? new Date() : parsed
  // The DOS epoch starts at 1980; anything earlier clamps to it.
  const year = Math.max(d.getFullYear(), 1980)

  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

let crcTable: Uint32Array | null = null

/** zlib.crc32 landed in Node 20.15; fall back for older runtimes. */
function crc32(buf: Buffer): number {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf)

  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[i] = c >>> 0
    }
  }

  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
