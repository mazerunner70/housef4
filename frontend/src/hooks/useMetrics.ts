import { useQuery } from '@tanstack/react-query'

import { getMetrics } from '@/api/client'

export function useMetrics(currency: string | undefined) {
  return useQuery({
    queryKey: ['metrics', currency],
    queryFn: () => getMetrics(currency!),
    enabled: Boolean(currency?.trim()),
  })
}
