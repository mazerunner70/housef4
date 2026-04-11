import { Navigate, Route, Routes } from 'react-router-dom'

import { CognitoGate } from '@/auth/CognitoGate'
import { AppLayout } from '@/components/layout/AppLayout'
import { DataImportPage } from '@/pages/DataImportPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { HomeRedirect } from '@/pages/HomeRedirect'
import { LoginPage } from '@/pages/LoginPage'
import { ReviewQueuePage } from '@/pages/ReviewQueuePage'
import { HealthCheckPage } from '@/pages/HealthCheckPage'

export default function App() {
  return (
    <Routes>
      <Route path="/health-check" element={<HealthCheckPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<CognitoGate />}>
        <Route index element={<HomeRedirect />} />
        <Route element={<AppLayout />}>
          <Route path="import" element={<DataImportPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="review-queue" element={<ReviewQueuePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
