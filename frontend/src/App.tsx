import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/layout/AppLayout'
import { DataImportPage } from '@/pages/DataImportPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { HomeRedirect } from '@/pages/HomeRedirect'
import { ReviewQueuePage } from '@/pages/ReviewQueuePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route element={<AppLayout />}>
        <Route path="import" element={<DataImportPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="review-queue" element={<ReviewQueuePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
