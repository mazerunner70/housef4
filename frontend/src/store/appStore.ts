import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ImportParseResult } from '@/lib/types'

type AppState = {
  hasUploadedData: boolean
  setHasUploadedData: (value: boolean) => void
  lastImportSummary: ImportParseResult | null
  setLastImportSummary: (summary: ImportParseResult | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasUploadedData: false,
      setHasUploadedData: (value) => set({ hasUploadedData: value }),
      lastImportSummary: null,
      setLastImportSummary: (summary) => set({ lastImportSummary: summary }),
    }),
    { name: 'housef4-app' },
  ),
)
