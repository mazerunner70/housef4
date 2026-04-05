import { useQuery } from '@tanstack/react-query'

import { getMetrics } from '@/api/client'

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
  })
}
