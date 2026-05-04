import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { cn } from '@/lib/cn'

export type SearchableSelectProps = Readonly<{
  options: readonly string[]
  value: string
  onChange: (option: string) => void
  disabled?: boolean
  id?: string
  placeholder?: string
  searchPlaceholder?: string
  /** Accessible name for the search field (paired with visually hidden label). */
  searchLabel?: string
  /** Fires when the menu opens or closes (e.g. lift parent z-index above sibling cards). */
  onOpenChange?: (open: boolean) => void
  className?: string
}>

export function SearchableSelect({
  options,
  value,
  onChange,
  disabled,
  id: idProp,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  searchLabel = 'Filter options',
  onOpenChange,
  className,
}: SearchableSelectProps) {
  const generatedId = useId()
  const baseId = idProp ?? generatedId
  const listId = `${baseId}-suggestions`
  const searchInputId = `${baseId}-search`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const onOpenChangeRef = useRef(onOpenChange)

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    onOpenChangeRef.current?.(open)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [...options]
    return options.filter((opt) => opt.toLowerCase().includes(q))
  }, [query, options])

  return (
    <div
      ref={rootRef}
      className={cn('relative min-w-0 flex-1 sm:min-w-[12rem]', className)}
    >
      <button
        id={baseId}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-strong)]',
          disabled && 'opacity-50',
        )}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="truncate">{value || placeholder}</span>
        <Search className="size-4 shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
        >
          <div className="border-b border-[var(--color-border)] p-2">
            <label className="sr-only" htmlFor={searchInputId}>
              {searchLabel}
            </label>
            <input
              id={searchInputId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1.5 text-sm text-[var(--color-text-strong)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
          <ul id={listId} className="max-h-48 overflow-auto py-1">
            {filtered.map((opt) => (
              <li key={opt} className="list-none">
                <button
                  type="button"
                  aria-current={opt === value ? true : undefined}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-accent-soft)]',
                    opt === value && 'bg-[var(--color-accent-soft)] font-medium',
                  )}
                  onClick={() => {
                    onChange(opt)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
