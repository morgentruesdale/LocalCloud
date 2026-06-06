'use client'

import { useEffect, useState } from 'react'
import type { FileMetadata } from '@/lib/types'
import UploadZone from './UploadZone'
import FileList from './FileList'

interface Props {
  serverIp: string
  port: string
}

export default function Dashboard({ serverIp, port }: Props) {
  const [files, setFiles] = useState<FileMetadata[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const es = new EventSource('/api/events')

    es.addEventListener('init', (e) => {
      setFiles(JSON.parse(e.data) as FileMetadata[])
      setConnected(true)
    })

    es.addEventListener('file-added', (e) => {
      const file = JSON.parse(e.data) as FileMetadata
      setFiles((prev) => [file, ...prev])
    })

    es.addEventListener('file-removed', (e) => {
      const { id } = JSON.parse(e.data) as { id: string }
      setFiles((prev) => prev.filter((f) => f.id !== id))
    })

    es.onerror = () => setConnected(false)
    es.onopen = () => setConnected(true)

    return () => es.close()
  }, [])

  const handleDelete = async (id: string) => {
    await fetch(`/api/files/${id}`, { method: 'DELETE' })
  }

  const url = `http://${serverIp}:${port}`

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">LocalCloud</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
              connected
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
            }`}>
              {connected ? 'live' : 'connecting'}
            </span>
          </div>

          <div className="text-right min-w-0">
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">other devices connect at</p>
            <p className="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300 truncate">{url}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <UploadZone />
        <FileList files={files} onDelete={handleDelete} />
      </main>
    </div>
  )
}
