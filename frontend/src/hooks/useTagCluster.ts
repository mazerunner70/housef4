import { useMutation, useQueryClient } from '@tanstack/react-query'

import { postTagRule } from '@/api/client'
import type { TagRuleRequest } from '@/lib/types'

export function useTagCluster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TagRuleRequest) => postTagRule(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['review-queue'],
        refetchType: 'all',
      })
      void queryClient.invalidateQueries({
        queryKey: ['transactions'],
        refetchType: 'all',
      })
      void queryClient.invalidateQueries({
        queryKey: ['metrics'],
        refetchType: 'all',
      })
    },
  })
}
