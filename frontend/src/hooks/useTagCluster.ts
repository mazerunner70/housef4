import { useMutation, useQueryClient } from '@tanstack/react-query'

import { postTagRule } from '@/api/client'
import type { TagRuleRequest } from '@/lib/types'

export function useTagCluster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TagRuleRequest) => postTagRule(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
  })
}
