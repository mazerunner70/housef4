/**
 * Supported bank / PFM export formats for import (Stage 1).
 * Backend `POST /api/imports` should accept the same set via multipart `file`.
 */
export const IMPORT_FILE_ACCEPT = [
  '.csv',
  '.ofx',
  '.qfx',
  '.qif',
  'text/csv',
  'application/csv',
  'application/x-ofx',
  'application/vnd.intu.qfx',
  'application/qif',
  'text/plain',
].join(',')

export type ImportSourceFormat = 'csv' | 'ofx' | 'qfx' | 'qif' | 'unknown'

export function detectImportFormat(file: File): ImportSourceFormat {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.qfx')) return 'qfx'
  if (name.endsWith('.ofx')) return 'ofx'
  if (name.endsWith('.qif')) return 'qif'

  const t = file.type.toLowerCase()
  if (t.includes('qfx') || t === 'application/x-ofx' || t === 'application/ofx')
    return 'ofx'
  if (t.includes('qif')) return 'qif'
  if (t.includes('csv') || t === 'text/plain') return 'csv'

  return 'unknown'
}

export function isSupportedImportFile(file: File): boolean {
  return detectImportFormat(file) !== 'unknown'
}
