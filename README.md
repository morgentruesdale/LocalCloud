# ☁️LocalCloud

A local network, self-hosted file transfer server that is vastly more efficient and intuitive than network folder sharing for the average user. 
Run it on one machine and any other device on the same network can upload and download files through a browser. 

The server writes to a scratch directory inside the system temp folder and cleans up a file immediately when it is deleted. The whole directory is removed when the server stops. Transfers stream to and from disk, so memory stays flat regardless of how much is stored.

Files are also evicted automatically 10 minutes after the last device disconnects, so an unattended server does not accumulate storage forever.

## Features

**Transfers**
- Upload files by dragging and dropping onto the page, or clicking to browse.
- Multiple files can be uploaded at once.
- Any device on the network can download any file independently.
- Download everything at once as a single zip.
- Delete individual files from the server.

**Real-time**
- Every connected device sees uploads and deletions instantly via Server-Sent Events.
- A live/connecting indicator shows whether the connection to the server is active.

**Session-scoped storage**
- Files are written to a per-run scratch directory under the system temp folder (`%TEMP%` on Windows, `$TMPDIR` on macOS, `/tmp` on Linux), created with owner-only permissions.
- Deleting a file unlinks it straight away, so the space comes back immediately.
- All files are gone when the server stops, including after Ctrl+C. A scratch directory left behind by a crash is swept on the next start.
- Nothing is cached or persisted between sessions.

**Idle eviction**
- A device counts as connected for as long as its dashboard is open, tracked through the same event stream that powers live updates.
- When the last device disconnects, a 10 minute grace period starts. Anyone reconnecting cancels it, so closing a tab to walk to another room never costs you the files.
- Leaving a dashboard open on any device holds the files indefinitely.

**Network**
- The dashboard header displays the exact URL other devices should open in their browser.
- The host's primary LAN IPv4 address is detected automatically.

**File list**
- Shows filename, size, uploader IP, and time since upload for each file.
- File type is indicated by colour (image, video, audio, text, other).

## Development

```bash
npm install
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000` on the host machine. Other devices on the network connect using the URL shown in the top-right corner of the dashboard.

## Production build

```bash
npm run build
npm start -- --hostname 0.0.0.0
```

## Distributable package

```bash
npm run package
```

This produces one zip per platform, each carrying a bundled Node runtime, so the
recipient needs **nothing installed**:

```
dist/
  windows/localcloud-0.1.0-windows.zip
  mac/localcloud-0.1.0-mac.zip
  linux/localcloud-0.1.0-linux.zip
```

Each zip unpacks to a single `localcloud/` folder holding the compiled server, its
assets, and the Node binaries for that platform only. Send one across, unpack it, and:

- **Windows:** double-click `start.bat`, or run `start.ps1`
- **Linux / macOS:** run `./start.sh`

The launchers pick the runtime matching the machine's architecture (x64 or arm64) and
fall back to `node` on `PATH` if it is absent. They pass `--expose-gc` so the server can
release upload buffers promptly; it runs fine without the flag, V8 just holds that memory
much longer than it needs to.

> On Windows, unpack somewhere reasonably shallow such as `C:\localcloud`. Some Next.js
> paths are long, and a deeply nested destination can exceed the 260-character path limit.

### Options

Runtimes are downloaded from nodejs.org, verified against the official `SHASUMS256.txt`,
and kept in `runtimes/` (git-ignored), so only the first build hits the network.

```bash
node scripts/package.mjs --platforms=linux,mac      # skip a platform
node scripts/package.mjs --arch=x64                 # one architecture only, ~halves each zip
node scripts/package.mjs --node-version=22.14.0     # pin the bundled runtime
node scripts/package.mjs --help
```

Both architectures ship by default, which puts each zip in the 68–90 MB range. Note that
`npm run package` rebuilds from source first; `node scripts/package.mjs` on its own just
repackages the existing build.

The server binds to `0.0.0.0:3000` by default. Set the `PORT` environment variable to use a different port.

The default per-file size limit is **500 MB**. Override it with the `MAX_FILE_SIZE_MB` environment variable:

```bash
MAX_FILE_SIZE_MB=2048 node server.js
```

Idle eviction defaults to **10 minutes** after the last device disconnects. Override it with `IDLE_EVICT_MINUTES`, or set it to `0` to keep files until they are deleted manually:

```bash
IDLE_EVICT_MINUTES=60 node server.js
IDLE_EVICT_MINUTES=0 node server.js
```

## Local dev config

Create `local.env.ts` in the project root to allow cross-origin requests from your device during development:

```ts
const LOCAL_DEV_IP = '192.168.x.x'
export default LOCAL_DEV_IP
```
