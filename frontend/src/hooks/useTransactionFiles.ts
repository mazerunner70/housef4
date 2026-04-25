import { useQuery } from '@tanstack/react-query'

import { getTransactionFiles } from '@/api/client'

export function useTransactionFiles() {
  return useQuery({
    queryKey: ['transaction-files'],
    queryFn: getTransactionFiles,
  })
}
