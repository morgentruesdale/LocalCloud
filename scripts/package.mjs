import { cp, rm, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

const OUT = 'dist'

if (!existsSync('.next/standalone')) {
  console.error('Error: .next/standalone not found. Run `npm run build` first.')
  process.exit(1)
}

console.log('Assembling dist...')

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

await cp('.next/standalone', OUT, { recursive: true })
await cp('.next/static', `${OUT}/.next/static`, { recursive: true })

if (existsSync('public')) {
  await cp('public', `${OUT}/public`, { recursive: true })
}

await writeFile(
  `${OUT}/start.bat`,
  '@echo off\r\nset HOSTNAME=0.0.0.0\r\nset PORT=3000\r\nnode "%~dp0server.js"\r\npause\r\n',
)

await writeFile(
  `${OUT}/start.ps1`,
  '$env:HOSTNAME="0.0.0.0"\n$env:PORT="3000"\nnode "$PSScriptRoot/server.js"\n',
)

console.log(`Done. Distributable folder: ${OUT}/`)
console.log('  Run: dist\\start.bat  (or  node dist/server.js)')
