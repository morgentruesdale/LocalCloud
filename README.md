# LocalCloud

A local network, self-hosted file transfer server that is vastly more efficient and intuitive than network folder sharing for the average user. 
Run it on one machine and any other device on the same network can upload and download files through a browser. No accounts, no internet, no installation on the other devices.

The server holds files in memory for the duration of the session only. Obviously this can quickly use a lot of memory, best practice is closing the server after use. 
If you want to keep it running in the background, you'll have to implement a time period buffer clear.

## Features

**Transfers**
- Upload files by dragging and dropping onto the page, or clicking to browse
- Multiple files can be uploaded at once
- Any device on the network can download any file independently
- Delete individual files from the server

**Real-time**
- Every connected device sees uploads and deletions instantly via Server-Sent Events. No refresh needed
- A live/connecting indicator shows whether the connection to the server is active

**Session-scoped storage**
- Files are held in memory only and are never written to disk on the host machine
- Very large file transfers are automatically denied to avoid overloading memory
- All files are gone when the server stops. Nothing is cached or persisted between sessions

**Network**
- The dashboard header displays the exact URL other devices should open in their browser
- The host's primary LAN IPv4 address is detected automatically

**File list**
- Shows filename, size, uploader IP, and time since upload for each file
- File type is indicated by colour (image, video, audio, text, other)

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

To produce a self-contained folder that can be run on any machine with Node.js installed:

```bash
npm run package
```

This outputs a `dist/` folder containing the compiled server and all assets. Copy the folder anywhere and launch it:

- **Windows:** double-click `start.bat`
- **PowerShell:** run `start.ps1`
- **Any platform:** `node server.js`

The server binds to `0.0.0.0:3000` by default. Set the `PORT` environment variable to use a different port.

The default per-file size limit is **500 MB**. Override it with the `MAX_FILE_SIZE_MB` environment variable:

```bash
MAX_FILE_SIZE_MB=2048 node server.js
```

## Local dev config

Create `local.env.ts` in the project root to allow cross-origin requests from your device during development:

```ts
const LOCAL_DEV_IP = '192.168.x.x'
export default LOCAL_DEV_IP
```
