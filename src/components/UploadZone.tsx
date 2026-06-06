'use client'

import { useCallback, useRef, useState } from 'react'

export default function UploadZone() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.size > 0)
    if (!files.length) return

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))
      const res = await fetch('/api/files', { method: 'POST', body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Upload failed')
      }
    } catch {
      setError('Upload failed. Check your connection.')
    } finally {
      setUploading(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length) upload(e.dataTransfer.files)
    },
    [upload],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        upload(e.target.files)
        e.target.value = ''
      }
    },
    [upload],
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload files"
      onClick={() => !uploading && inputRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && !uploading && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false) }}
      onDrop={handleDrop}
      className={`relative cursor-pointer select-none border-2 border-dashed rounded-xl p-10 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        uploading
          ? 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 cursor-wait'
          : isDragging
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
          : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleChange}
        className="hidden"
        disabled={uploading}
      />

      <div className="space-y-2 pointer-events-none">
        {uploading ? (
          <>
            <div className="w-9 h-9 mx-auto border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Uploading…</p>
          </>
        ) : (
          <>
            <svg className="w-9 h-9 mx-auto text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Drop files here or{' '}
              <span className="text-blue-600 dark:text-blue-400 font-medium">browse</span>
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Any file type · multiple files OK</p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400 pointer-events-none">{error}</p>
      )}
    </div>
  )
}
