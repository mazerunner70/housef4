import type {
  ImportParseResult,
  MetricsResponse,
  ReviewQueueResponse,
  TagRuleRequest,
  TagRuleResponse,
  TransactionsResponse,
} from '@/lib/types'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const res = await fetch(path, {
    ...init,
    headers: isFormData
      ? { ...init?.headers }
      : {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
  })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

/**
 * `POST /api/imports` — multipart field name **`file`** (see API contract).
 */
export async function postImport(file: File): Promise<ImportParseResult> {
  const body = new FormData()
  body.append('file', file)
  return fetchJson<ImportParseResult>('/api/imports', { method: 'POST', body })
}

export async function getMetrics(): Promise<MetricsResponse> {
  return fetchJson<MetricsResponse>('/api/metrics')
}

export async function getTransactions(): Promise<TransactionsResponse> {
  return fetchJson<TransactionsResponse>('/api/transactions')
}

export async function getReviewQueue(): Promise<ReviewQueueResponse> {
  return fetchJson<ReviewQueueResponse>('/api/review-queue')
}

export async function postTagRule(
  body: TagRuleRequest,
): Promise<TagRuleResponse> {
  return fetchJson<TagRuleResponse>('/api/rules/tag', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
