'use client'

import { useState } from 'react'
import type { FileMetadata } from '@/lib/types'

interface Props {
  files: FileMetadata[]
  onDelete: (id: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function FileList({ files, onDelete }: Props) {
  const [deleting, setDeleting] = useState<Set<string>>(new Set())

  const handleDelete = async (id: string) => {
    setDeleting((prev) => new Set(prev).add(id))
    await onDelete(id)
    setDeleting((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  if (!files.length) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-10 text-center">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No files yet. Upload something above.</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>

        <a
          href="/api/archive"
          download
          className="flex items-center gap-1.5 px-2.5 py-1 -my-0.5 text-xs font-medium rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download all as zip
        </a>
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
          >
            <FileIcon type={file.type} />

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{file.name}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                {formatBytes(file.size)}
                <span className="mx-1.5">·</span>
                {file.uploaderIp}
                <span className="mx-1.5">·</span>
                {timeAgo(file.uploadedAt)}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <a
                href={`/api/files/${file.id}`}
                download={file.name}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </a>
              <button
                onClick={() => handleDelete(file.id)}
                disabled={deleting.has(file.id)}
                aria-label={`Delete ${file.name}`}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40 transition-colors"
              >
                {deleting.has(file.id) ? (
                  <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FileIcon({ type }: { type: string }) {
  const category = type.split('/')[0]

  const colors: Record<string, string> = {
    image: 'text-purple-500',
    video: 'text-red-500',
    audio: 'text-yellow-500',
    text: 'text-green-500',
    application: 'text-blue-500',
  }

  const color = colors[category] ?? 'text-zinc-400'

  return (
    <div className={`shrink-0 ${color}`}>
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
  )
}
