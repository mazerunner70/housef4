import { Navigate, Route, Routes } from 'react-router-dom'

import { CognitoGate } from '@/auth/CognitoGate'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { DataBackupSettingsPage } from '@/pages/DataBackupSettingsPage.tsx'
import { DataImportPage } from '@/pages/DataImportPage'
import { HealthCheckPage } from '@/pages/HealthCheckPage'
import { HomeRedirect } from '@/pages/HomeRedirect'
import { ImportTransactionsReviewPage } from '@/pages/ImportTransactionsReviewPage'
import { LoginPage } from '@/pages/LoginPage'
import { ReviewQueuePage } from '@/pages/ReviewQueuePage'

export default function App() {
  return (
    <Routes>
      <Route path="/health-check" element={<HealthCheckPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<CognitoGate />}>
        <Route index element={<HomeRedirect />} />
        <Route element={<AppLayout />}>
          <Route path="import" element={<DataImportPage />} />
          <Route
            path="import/review-transactions"
            element={<ImportTransactionsReviewPage />}
          />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="review-queue" element={<ReviewQueuePage />} />
          <Route path="settings/data" element={<DataBackupSettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
