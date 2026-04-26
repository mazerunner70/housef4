import { useCallback, useId, useState } from 'react'
import { FileUp } from 'lucide-react'

import { IMPORT_FILE_ACCEPT, isSupportedImportFile } from '@/lib/importFormats'
import { cn } from '@/lib/cn'

type ImportDropzoneProps = {
  onFileSelected: (file: File) => void
  /** When set, the zone does not accept files or file-picker activation. */
  disabled?: boolean
  /** Shown when `disabled` (e.g. explain that an account must be selected first). */
  disabledMessage?: string
  className?: string
}

export function ImportDropzone({
  onFileSelected,
  disabled = false,
  disabledMessage = 'Select an account above to enable upload.',
  className,
}: ImportDropzoneProps) {
  const inputId = useId()
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (disabled) return
      const file = files?.[0]
      if (!file) return
      if (!isSupportedImportFile(file)) {
        return
      }
      onFileSelected(file)
    },
    [disabled, onFileSelected],
  )

  return (
    <div
      className={cn(
        'rounded-2xl border-2 border-dashed border-white/[0.12] bg-white/[0.03] p-8 transition',
        !disabled && isDragging && 'border-emerald-400/50 bg-emerald-500/10',
        disabled && 'cursor-not-allowed border-zinc-600/30 bg-zinc-950/40 opacity-70',
        className,
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
        accept={IMPORT_FILE_ACCEPT}
        className="sr-only"
        disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        className={cn(
          'flex flex-col items-center gap-3 text-center',
          !disabled && 'cursor-pointer',
        )}
      >
        {disabled ? (
          <div
            className="flex flex-col items-center gap-3 text-center"
            role="status"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-zinc-600/20 text-zinc-500">
              <FileUp className="size-7" aria-hidden />
            </span>
            <span className="text-base font-medium text-zinc-500">
              File upload
            </span>
            <span className="max-w-md text-sm text-zinc-500">{disabledMessage}</span>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            className="flex cursor-pointer flex-col items-center gap-3 text-center"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-violet-500/15 text-violet-400">
              <FileUp className="size-7" aria-hidden />
            </span>
            <span className="text-base font-medium text-zinc-100">
              Drop your bank export here
            </span>
            <span className="max-w-md text-sm text-zinc-500">
              Or click to browse. CSV, OFX, QFX, or QIF from your bank or app. Use
              a single account when possible; we normalize common layouts in the
              parser.
            </span>
          </label>
        )}
      </div>
    </div>
  )
}
