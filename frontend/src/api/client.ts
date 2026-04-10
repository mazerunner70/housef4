import type {
  ImportParseResult,
  MetricsResponse,
  ReviewQueueResponse,
  TagRuleRequest,
  TagRuleResponse,
  TransactionsResponse,
} from '@/lib/types'

export type ApiAuthTokenGetter = () => string | undefined

let apiAuthTokenGetter: ApiAuthTokenGetter | undefined

/**
 * Wire a Cognito (or other) access token for production HTTP calls.
 * Leave unset for local dev behind the Vite `/api` proxy.
 */
export function setApiAuthTokenGetter(getter: ApiAuthTokenGetter | undefined) {
  apiAuthTokenGetter = getter
}

export type BearerTokenResolver = () => Promise<string | undefined>

let bearerTokenResolver: BearerTokenResolver | undefined

/**
 * Async resolver (e.g. Cognito `getSession` refresh) runs before each API call.
 * Falls back to {@link setApiAuthTokenGetter} / `VITE_API_BEARER_TOKEN` when unset
 * or when the resolver returns nothing.
 */
export function setBearerTokenResolver(
  resolver: BearerTokenResolver | undefined,
) {
  bearerTokenResolver = resolver
}

async function authorizationHeader(): Promise<Record<string, string>> {
  let raw: string | undefined
  if (bearerTokenResolver) {
    const t = await bearerTokenResolver()
    raw = t?.trim() || undefined
  }
  if (!raw) {
    raw =
      apiAuthTokenGetter?.()?.trim() ||
      import.meta.env.VITE_API_BEARER_TOKEN?.trim() ||
      undefined
  }
  if (!raw) return {}
  return { Authorization: `Bearer ${raw}` }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const auth = await authorizationHeader()
  const res = await fetch(path, {
    ...init,
    headers: isFormData
      ? { ...auth, ...init?.headers }
      : {
          'Content-Type': 'application/json',
          ...auth,
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
