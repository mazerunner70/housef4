import { useCallback, useId, useState } from 'react'
import { FileUp } from 'lucide-react'

import { IMPORT_FILE_ACCEPT, isSupportedImportFile } from '@/lib/importFormats'
import { cn } from '@/lib/cn'

type ImportDropzoneProps = {
  onFileSelected: (file: File) => void
  disabled?: boolean
  className?: string
}

export function ImportDropzone({
  onFileSelected,
  disabled,
  className,
}: ImportDropzoneProps) {
  const inputId = useId()
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      if (!isSupportedImportFile(file)) {
        return
      }
      onFileSelected(file)
    },
    [onFileSelected],
  )

  return (
    <div
      className={cn(
        'rounded-2xl border-2 border-dashed border-white/[0.12] bg-white/[0.03] p-8 transition',
        isDragging && 'border-emerald-400/50 bg-emerald-500/10',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
      onDragEnter={() => setIsDragging(true)}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        id={inputId}
        type="file"
        accept={IMPORT_FILE_ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
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
          Or click to browse. CSV, OFX, QFX, or QIF from your bank or app. Use a
          single account when possible; we normalize common layouts in the
          parser.
        </span>
      </label>
    </div>
  )
}
