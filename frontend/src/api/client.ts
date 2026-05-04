import type {
  AccountsResponse,
  BackupExportDownload,
  ImportParseResult,
  MetricsResponse,
  ReviewQueueResponse,
  TagRuleRequest,
  TagRuleResponse,
  TransactionFilesResponse,
  TransactionsResponse,
} from '@/lib/types'

export type HealthResponse = {
  status: string
  build: string
  diagnostic: { code: string; hint: string }
}

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

const DEFAULT_BACKUP_FILENAME = 'housef4-backup.json'

function parseContentDispositionFilename(
  contentDisposition: string | null,
): string | undefined {
  if (!contentDisposition) return undefined
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(contentDisposition)
  if (star?.[1]) {
    const raw = star[1].trim().replaceAll(/^["']|["']$/g, '')
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(contentDisposition)
  if (quoted?.[1]) return quoted[1]
  const loose = /filename=([^;\s]+)/i.exec(contentDisposition)
  if (loose?.[1]) return loose[1].replaceAll(/^["']|["']$/g, '')
  return undefined
}

/** Save a blob with a suggested filename (object URL + programmatic click). */
export function downloadBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * `GET /api/backup/export` — authenticated JSON snapshot; returns a blob and
 * filename for {@link downloadBlobAsFile}.
 */
export async function getBackupExport(): Promise<BackupExportDownload> {
  const auth = await authorizationHeader()
  const res = await fetch('/api/backup/export', {
    method: 'GET',
    cache: 'no-store',
    headers: { ...auth },
  })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  const blob = await res.blob()
  const filename =
    parseContentDispositionFilename(res.headers.get('Content-Disposition')) ??
    DEFAULT_BACKUP_FILENAME
  return { blob, filename }
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

/** `GET /api/health` — public; `build` comes from DynamoDB PK=health-check, SK=BUILD. */
export async function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>('/api/health', {
    method: 'GET',
    cache: 'no-store',
  })
}

export type PostImportAccount =
  | { accountId: string; newAccountName?: never }
  | { accountId?: never; newAccountName: string }

/**
 * `POST /api/imports` — multipart: **`file`**, and either **`account_id`** or
 * **`new_account_name`** (see API contract).
 */
export async function postImport(
  file: File,
  account: PostImportAccount,
): Promise<ImportParseResult> {
  const body = new FormData()
  body.append('file', file)
  if (typeof account.accountId === 'string') {
    body.append('account_id', account.accountId)
  } else {
    body.append('new_account_name', account.newAccountName)
  }
  return fetchJson<ImportParseResult>('/api/imports', { method: 'POST', body })
}

export async function getMetrics(): Promise<MetricsResponse> {
  return fetchJson<MetricsResponse>('/api/metrics', { cache: 'no-store' })
}

export type GetTransactionsOptions = {
  transactionFileId?: string
  clusterId?: string
}

export async function getTransactions(
  opts?: GetTransactionsOptions,
): Promise<TransactionsResponse> {
  const q = new URLSearchParams()
  const fid = opts?.transactionFileId?.trim()
  const cid = opts?.clusterId?.trim()
  if (fid) q.set('transactionFileId', fid)
  if (cid) q.set('clusterId', cid)
  const qs = q.toString()
  const path = qs.length > 0 ? `/api/transactions?${qs}` : '/api/transactions'
  return fetchJson<TransactionsResponse>(path)
}

export async function getTransactionFiles(): Promise<TransactionFilesResponse> {
  return fetchJson<TransactionFilesResponse>('/api/transaction-files')
}

export async function getAccounts(): Promise<AccountsResponse> {
  return fetchJson<AccountsResponse>('/api/accounts')
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
