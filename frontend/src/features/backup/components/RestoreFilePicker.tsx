import { useCallback, useId, useState } from 'react'
import { FileJson } from 'lucide-react'

import { cn } from '@/lib/cn'

const ACCEPT = '.json,application/json'

/** Matches backend **`BACKUP_MULTIPART_MAX_FILE_BYTES`** (80 MiB). */
const MAX_BYTES_HINT = 80 * 1024 * 1024

type RestoreFilePickerProps = {
  file: File | null
  onFileSelected: (file: File) => void
  disabled?: boolean
  className?: string
}

export function RestoreFilePicker({
  file,
  onFileSelected,
  disabled = false,
  className,
}: RestoreFilePickerProps) {
  const inputId = useId()
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (disabled) return
      const next = files?.[0]
      if (!next) return
      onFileSelected(next)
    },
    [disabled, onFileSelected],
  )

  return (
    <div className={cn('space-y-4', className)}>
      <div
        className={cn(
          'rounded-2xl border-2 border-dashed border-white/[0.12] bg-white/[0.03] p-8 transition',
          !disabled && isDragging && 'border-amber-400/40 bg-amber-500/10',
          disabled &&
            'cursor-not-allowed border-zinc-600/30 bg-zinc-950/40 opacity-70',
        )}
        aria-disabled={disabled}
        onDragEnter={(e) => {
          e.preventDefault()
          if (disabled) {
            e.dataTransfer.dropEffect = 'none'
            return
          }
          setIsDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (disabled) {
            e.dataTransfer.dropEffect = 'none'
            return
          }
          e.dataTransfer.dropEffect = 'copy'
          setIsDragging(true)
        }}
        onDragLeave={() => {
          if (!disabled) setIsDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (disabled) {
            e.dataTransfer.dropEffect = 'none'
            return
          }
          handleFiles(e.dataTransfer.files)
        }}
      >
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="flex flex-col items-center gap-3 text-center">
          <FileJson
            className="size-10 text-zinc-500"
            strokeWidth={1.25}
            aria-hidden
          />
          <p className="text-sm text-zinc-300">
            Drag and drop your backup JSON here, or{' '}
            <label
              htmlFor={inputId}
              className={cn(
                'cursor-pointer font-medium text-[var(--color-accent)] underline-offset-2 hover:underline',
                disabled && 'pointer-events-none opacity-50',
              )}
            >
              choose a file
            </label>
            .
          </p>
          <p className="text-xs text-zinc-500">
            Accepted: JSON exports from this app · up to{' '}
            {Math.round(MAX_BYTES_HINT / (1024 * 1024))} MB
          </p>
        </div>
      </div>

      {file && (
        <p className="text-sm text-zinc-400">
          Selected: <span className="font-medium text-zinc-200">{file.name}</span>
        </p>
      )}
    </div>
  )
}
