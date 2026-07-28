import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { createHash } from 'crypto'
import { deflateRawSync, gunzipSync, inflateRawSync } from 'zlib'
import { once } from 'events'
import path from 'path'

const OUT = 'dist'
const RUNTIMES_DIR = 'runtimes'

// Where the node executable lives inside each official archive, and what it is
// called once extracted into runtimes/v<version>/<target>/.
const RUNTIMES = {
  'win-x64': { ext: 'zip', entry: 'node.exe', bin: 'node.exe' },
  'win-arm64': { ext: 'zip', entry: 'node.exe', bin: 'node.exe' },
  'linux-x64': { ext: 'tar.gz', entry: 'bin/node', bin: 'node' },
  'linux-arm64': { ext: 'tar.gz', entry: 'bin/node', bin: 'node' },
  'darwin-x64': { ext: 'tar.gz', entry: 'bin/node', bin: 'node' },
  'darwin-arm64': { ext: 'tar.gz', entry: 'bin/node', bin: 'node' },
}

// One zip per platform, carrying only the runtimes and launchers that platform
// can actually use. Both architectures ride along because the launchers pick
// between them at startup, and a zip is the only thing the recipient sees.
const PLATFORMS = {
  windows: { targets: ['win-x64', 'win-arm64'], launchers: ['start.bat', 'start.ps1'] },
  mac: { targets: ['darwin-x64', 'darwin-arm64'], launchers: ['start.sh'] },
  linux: { targets: ['linux-x64', 'linux-arm64'], launchers: ['start.sh'] },
}

const MODE_FILE = 0o100644
const MODE_EXEC = 0o100755
const MODE_DIR = 0o040755

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node scripts/package.mjs [options]

  --platforms=<list>      Which packages to build. Comma-separated:
                            ${Object.keys(PLATFORMS).join(', ')}
                          Defaults to all three.
  --arch=<list>           Which architectures to bundle: x64, arm64 or all.
                          Defaults to all.
  --node-version=<x.y.z>  Node runtime to bundle.
                          Defaults to this Node (${process.versions.node}).

Runtimes are downloaded from nodejs.org, verified against the official
SHASUMS256.txt and kept in ${RUNTIMES_DIR}/ so later runs reuse them.`)
  process.exit(0)
}

function listArg(name) {
  const arg = args.find((a) => a.startsWith(`--${name}=`))
  if (!arg) return null
  return arg.slice(arg.indexOf('=') + 1).split(',').map((s) => s.trim()).filter(Boolean)
}

const platforms = listArg('platforms') ?? Object.keys(PLATFORMS)
for (const platform of platforms) {
  if (!PLATFORMS[platform]) {
    console.error(`Error: unknown platform "${platform}".`)
    console.error(`Valid platforms: ${Object.keys(PLATFORMS).join(', ')}`)
    process.exit(1)
  }
}

const archArg = listArg('arch') ?? ['all']
const arches = archArg.includes('all') ? ['x64', 'arm64'] : archArg
for (const arch of arches) {
  if (arch !== 'x64' && arch !== 'arm64') {
    console.error(`Error: unknown architecture "${arch}". Valid: x64, arm64, all`)
    process.exit(1)
  }
}

const versionArg = args.find((a) => a.startsWith('--node-version='))
const nodeVersion = (versionArg?.split('=')[1] ?? process.versions.node).replace(/^v/, '')

if (!existsSync('.next/standalone')) {
  console.error('Error: .next/standalone not found. Run `npm run build` first.')
  process.exit(1)
}

const appVersion = JSON.parse(await readFile('package.json', 'utf8')).version

// --- fetching runtimes -------------------------------------------------------

// SHASUMS256.txt for the requested version, fetched once and reused.
let shasums = null

async function expectedHash(file) {
  if (!shasums) {
    const url = `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`)
    shasums = await res.text()
  }
  for (const line of shasums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name === file) return hash
  }
  throw new Error(`${file} not listed in SHASUMS256.txt for v${nodeVersion}`)
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

function cstr(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.toString('utf8', 0, end === -1 ? slice.length : end)
}

// Pulling one member out of each archive ourselves keeps packaging independent
// of whatever `tar`/`unzip` happens to be on PATH - GNU tar cannot read zip,
// and on Windows it routinely shadows the bsdtar that can.
function readFromTarGz(buf, member) {
  const tar = gunzipSync(buf)
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const name = cstr(header, 0, 100)
    const prefix = cstr(header, 345, 155)
    const size = parseInt(cstr(header, 124, 12).trim() || '0', 8)
    const type = header[156]
    const data = off + 512
    if ((prefix ? `${prefix}/${name}` : name) === member && (type === 0x30 || type === 0)) {
      return tar.subarray(data, data + size)
    }
    off = data + Math.ceil(size / 512) * 512
  }
  return null
}

function readFromZip(buf, member) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('zip: end of central directory not found')

  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('zip: bad central directory')
    const method = buf.readUInt16LE(ptr + 10)
    const compressed = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOff = buf.readUInt32LE(ptr + 42)
    if (buf.toString('utf8', ptr + 46, ptr + 46 + nameLen) === member) {
      // The local header repeats name/extra with its own lengths.
      const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28)
      const data = buf.subarray(start, start + compressed)
      return method === 0 ? data : inflateRawSync(data)
    }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return null
}

// Returns the path to runtimes/v<version>/<target>/node, downloading it once.
async function ensureRuntime(target) {
  const { ext, entry, bin } = RUNTIMES[target]
  const dest = path.join(RUNTIMES_DIR, `v${nodeVersion}`, target, bin)
  if (existsSync(dest)) return dest

  const name = `node-v${nodeVersion}-${target}`
  const file = `${name}.${ext}`
  const url = `https://nodejs.org/dist/v${nodeVersion}/${file}`
  const tmp = path.join(RUNTIMES_DIR, '.tmp', file)

  console.log(`  fetching ${url}`)
  await mkdir(path.dirname(tmp), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`)
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()))

  try {
    const actual = await sha256(tmp)
    const expected = await expectedHash(file)
    if (actual !== expected) {
      throw new Error(`checksum mismatch for ${file} (expected ${expected}, got ${actual})`)
    }

    const member = `${name}/${entry}`
    const buf = await readFile(tmp)
    const data = ext === 'zip' ? readFromZip(buf, member) : readFromTarGz(buf, member)
    if (!data) throw new Error(`${member} not found in ${file}`)

    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, data)
    if (bin !== 'node.exe') await chmod(dest, 0o755)
  } finally {
    await rm(path.join(RUNTIMES_DIR, '.tmp'), { recursive: true, force: true })
  }

  return dest
}

// --- writing zips ------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

// A minimal zip writer, for the same reason we read archives by hand. It also
// lets us stamp Unix permission bits, without which `node` and `start.sh` come
// out of the zip non-executable on Linux and macOS.
class ZipWriter {
  #stream
  #offset = 0
  #entries = []
  #added = new Set()
  #time
  #date

  constructor(file) {
    this.#stream = createWriteStream(file)
    const now = new Date()
    this.#time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    this.#date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  }

  #write(buf) {
    return new Promise((resolve, reject) => {
      this.#stream.write(buf, (err) => (err ? reject(err) : resolve()))
    })
  }

  async add(name, data, mode) {
    if (this.#added.has(name)) return
    this.#added.add(name)

    const isDir = name.endsWith('/')
    const body = isDir ? Buffer.alloc(0) : deflateRawSync(data)
    // Deflate can grow already-compressed data; store those entries verbatim.
    const deflated = !isDir && body.length < data.length
    const payload = isDir ? body : deflated ? body : data
    const crc = isDir ? 0 : crc32(data)
    const nameBuf = Buffer.from(name, 'utf8')

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6) // names are UTF-8
    header.writeUInt16LE(deflated ? 8 : 0, 8)
    header.writeUInt16LE(this.#time, 10)
    header.writeUInt16LE(this.#date, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(isDir ? 0 : data.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)

    this.#entries.push({
      nameBuf,
      crc,
      compressed: payload.length,
      size: isDir ? 0 : data.length,
      method: deflated ? 8 : 0,
      attrs: isDir ? ((mode << 16) >>> 0) | 0x10 : (mode << 16) >>> 0,
      offset: this.#offset,
    })

    await this.#write(header)
    await this.#write(nameBuf)
    if (payload.length) await this.#write(payload)
    this.#offset += header.length + nameBuf.length + payload.length
  }

  async addFile(name, file, mode) {
    await this.add(name, await readFile(file), mode)
  }

  async close() {
    if (this.#entries.length > 0xffff) {
      throw new Error(`zip: ${this.#entries.length} entries exceeds the non-zip64 limit`)
    }

    const start = this.#offset
    for (const e of this.#entries) {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(0x031e, 4) // made by Unix, spec 3.0 - enables the mode bits
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(0x0800, 8)
      header.writeUInt16LE(e.method, 10)
      header.writeUInt16LE(this.#time, 12)
      header.writeUInt16LE(this.#date, 14)
      header.writeUInt32LE(e.crc, 16)
      header.writeUInt32LE(e.compressed, 20)
      header.writeUInt32LE(e.size, 24)
      header.writeUInt16LE(e.nameBuf.length, 28)
      header.writeUInt16LE(0, 30) // extra
      header.writeUInt16LE(0, 32) // comment
      header.writeUInt16LE(0, 34) // disk
      header.writeUInt16LE(0, 36) // internal attrs
      header.writeUInt32LE(e.attrs, 38)
      header.writeUInt32LE(e.offset, 42)
      await this.#write(header)
      await this.#write(e.nameBuf)
      this.#offset += header.length + e.nameBuf.length
    }

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(this.#entries.length, 8)
    eocd.writeUInt16LE(this.#entries.length, 10)
    eocd.writeUInt32LE(this.#offset - start, 12)
    eocd.writeUInt32LE(start, 16)
    eocd.writeUInt16LE(0, 20)
    await this.#write(eocd)

    this.#stream.end()
    await once(this.#stream, 'finish')
  }
}

// `skip` applies only at the level it is passed, not to nested directories.
async function* walk(dir, prefix, skip = new Set()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    const name = `${prefix}/${entry.name}`
    // Resolve symlinks rather than skipping them; some installs link into
    // node_modules and a dropped link is a missing dependency at runtime.
    const info = entry.isSymbolicLink() ? await stat(abs) : entry
    if (info.isDirectory()) {
      yield { name: `${name}/`, dir: true }
      yield* walk(abs, name)
    } else if (info.isFile()) {
      yield { name, abs }
    }
  }
}

// --- launchers ---------------------------------------------------------------

// --expose-gc lets the server reclaim upload buffers promptly. Without it the
// server still works; V8 just holds that memory far longer than it needs to.
// Each launcher picks the runtime matching the machine it is run on and falls
// back to PATH, so the package still works if its runtime was left out.
const LAUNCHERS = {
  'start.bat': [
    '@echo off',
    'setlocal',
    'set HOSTNAME=0.0.0.0',
    'set PORT=3000',
    'set "ARCH=x64"',
    'if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"',
    'set "NODE_BIN=%~dp0runtime\\win-%ARCH%\\node.exe"',
    'if not exist "%NODE_BIN%" set "NODE_BIN=node"',
    '"%NODE_BIN%" --expose-gc "%~dp0server.js"',
    'pause',
    '',
  ].join('\r\n'),

  'start.ps1': [
    '$env:HOSTNAME = "0.0.0.0"',
    '$env:PORT = "3000"',
    "$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }",
    '$node = Join-Path $PSScriptRoot "runtime/win-$arch/node.exe"',
    "if (-not (Test-Path $node)) { $node = 'node' }",
    "& $node --expose-gc (Join-Path $PSScriptRoot 'server.js')",
    '',
  ].join('\n'),

  'start.sh': [
    '#!/bin/sh',
    'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'export HOSTNAME=0.0.0.0',
    'export PORT=3000',
    'case "$(uname -s)" in',
    '  Darwin) OS=darwin ;;',
    '  *) OS=linux ;;',
    'esac',
    'case "$(uname -m)" in',
    '  arm64|aarch64) ARCH=arm64 ;;',
    '  *) ARCH=x64 ;;',
    'esac',
    'NODE_BIN="$DIR/runtime/$OS-$ARCH/node"',
    '[ -x "$NODE_BIN" ] || NODE_BIN=node',
    'exec "$NODE_BIN" --expose-gc "$DIR/server.js"',
    '',
  ].join('\n'),
}

// --- build -------------------------------------------------------------------

// Deliberately unversioned: Next's node_modules paths are long, and on Windows
// every character here counts against the 260-char limit when the recipient
// extracts. The version lives in the zip filename instead.
const ROOT = 'localcloud'

// Source tree -> path inside the zip. server.js and its node_modules sit at the
// standalone root; static assets have to be put back where server.js looks.
// Output file tracing can sweep our own build output into the standalone root,
// which would embed the previous run's zips in this one and compound every
// build. next.config.ts excludes them from the trace; this is the backstop.
const PAYLOAD = [
  ['.next/standalone', '', new Set([OUT, RUNTIMES_DIR])],
  ['.next/static', '/.next/static'],
  ...(existsSync('public') ? [['public', '/public']] : []),
]

async function buildPackage(platform) {
  const { targets, launchers } = PLATFORMS[platform]
  const wanted = targets.filter((t) => arches.some((a) => t.endsWith(`-${a}`)))

  const runtimes = []
  for (const target of wanted) runtimes.push([target, await ensureRuntime(target)])

  const dir = path.join(OUT, platform)
  const zipPath = path.join(dir, `localcloud-${appVersion}-${platform}.zip`)
  await mkdir(dir, { recursive: true })

  const zip = new ZipWriter(zipPath)
  await zip.add(`${ROOT}/`, Buffer.alloc(0), MODE_DIR)

  for (const [src, prefix, skip] of PAYLOAD) {
    for await (const entry of walk(src, `${ROOT}${prefix}`, skip)) {
      if (entry.dir) await zip.add(entry.name, Buffer.alloc(0), MODE_DIR)
      else await zip.addFile(entry.name, entry.abs, MODE_FILE)
    }
  }

  for (const launcher of launchers) {
    const executable = launcher.endsWith('.sh')
    await zip.add(`${ROOT}/${launcher}`, Buffer.from(LAUNCHERS[launcher]), executable ? MODE_EXEC : MODE_FILE)
  }

  await zip.add(`${ROOT}/runtime/`, Buffer.alloc(0), MODE_DIR)
  for (const [target, bin] of runtimes) {
    await zip.add(`${ROOT}/runtime/${target}/`, Buffer.alloc(0), MODE_DIR)
    await zip.addFile(`${ROOT}/runtime/${target}/${RUNTIMES[target].bin}`, bin, MODE_EXEC)
  }

  await zip.close()
  return { zipPath, targets: wanted, size: (await stat(zipPath)).size }
}

await rm(OUT, { recursive: true, force: true })

const built = []
for (const platform of platforms) {
  console.log(`Building ${platform} package (node v${nodeVersion})...`)
  built.push(await buildPackage(platform))
}

console.log(`\nDone. Packages in ${OUT}/`)
for (const { zipPath, targets, size } of built) {
  const mb = Math.round((size / 1024 / 1024) * 10) / 10
  console.log(`  ${zipPath}  ${mb} MB  [${targets.join(', ')}]`)
}
console.log(`\nRuntimes cached in ${RUNTIMES_DIR}/v${nodeVersion}/`)
console.log(`Each zip unpacks to ${ROOT}/ and needs no Node installation:`)
console.log('  Windows:      start.bat')
console.log('  Linux/macOS:  ./start.sh')
