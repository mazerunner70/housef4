import { useQuery } from '@tanstack/react-query'

import { getReviewQueue } from '@/api/client'

export function useReviewQueue() {
  return useQuery({
    queryKey: ['review-queue'],
    queryFn: getReviewQueue,
  })
}
