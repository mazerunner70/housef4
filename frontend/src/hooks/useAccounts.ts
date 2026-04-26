import { useQuery } from '@tanstack/react-query'

import { getAccounts } from '@/api/client'

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: getAccounts,
  })
}
