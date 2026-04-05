import { Navigate } from 'react-router-dom'

import { useAppStore } from '@/store/appStore'

export function HomeRedirect() {
  const hasUploadedData = useAppStore((s) => s.hasUploadedData)
  return (
    <Navigate to={hasUploadedData ? '/dashboard' : '/import'} replace />
  )
}
