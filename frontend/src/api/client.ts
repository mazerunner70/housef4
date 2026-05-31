import type {
  AccountsResponse,
  BackupExportDownload,
  BackupRestoreAbortResponse,
  BackupRestoreResponse,
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
const DEFAULT_TRANSACTIONS_CSV_FILENAME = 'housef4-transactions.csv'

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
  setTimeout(() => URL.revokeObjectURL(url), 0)
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

/**
 * `GET /api/transactions/export` — CSV table of transactions (optional filters
 * match `GET /api/transactions`).
 */
export async function getTransactionsCsvExport(opts?: {
  transactionFileId?: string
  clusterId?: string
}): Promise<BackupExportDownload> {
  const auth = await authorizationHeader()
  const qs = new URLSearchParams()
  const fileId = opts?.transactionFileId?.trim()
  const clusterId = opts?.clusterId?.trim()
  if (fileId) qs.set('transactionFileId', fileId)
  if (clusterId) qs.set('clusterId', clusterId)
  const qstr = qs.toString()
  const path =
    qstr.length > 0
      ? `/api/transactions/export?${qstr}`
      : '/api/transactions/export'
  const res = await fetch(path, {
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
    DEFAULT_TRANSACTIONS_CSV_FILENAME
  return { blob, filename }
}

/** Raw HTTP response body as UTF-8 text (may be empty). */
export type ApiHttpErrorBody = string

/** Non-OK HTTP response with the entity body as text. */
export class ApiHttpError extends Error {
  readonly status: number
  readonly statusText: string
  readonly body: ApiHttpErrorBody

  constructor(status: number, statusText: string, body: ApiHttpErrorBody = '') {
    super(`${status} ${statusText}`)
    this.name = 'ApiHttpError'
    this.status = status
    this.statusText = statusText
    this.body = body
  }
}

type ApiErrorJson = {
  error?: string
  message?: string
  account_currency?: string
  file_currency?: string
}

/** User-facing text from a structured API error body. */
export function formatApiHttpErrorMessage(err: ApiHttpError): string {
  const trimmed = err.body.trim()
  if (trimmed) {
    try {
      const data = JSON.parse(trimmed) as ApiErrorJson
      if (data.error === 'currency_mismatch') {
        const importCurrency = data.account_currency?.trim()
        const file = data.file_currency?.trim()
        if (importCurrency && file) {
          return `The import file currency (${file}) does not match the selected import currency (${importCurrency}).`
        }
        if (importCurrency) {
          return `Import currency does not match the selected import currency (${importCurrency}).`
        }
      }
      if (typeof data.message === 'string' && data.message.trim()) {
        return data.message.trim()
      }
    } catch {
      // fall through to status line
    }
  }
  return err.message
}

async function readResponseText(res: Response): Promise<string> {
  return res.text()
}

/**
 * `POST /api/backup/restore` — multipart **`backup`** part (`api_contract.md` §6).
 */
export async function postBackupRestore(
  file: File,
): Promise<BackupRestoreResponse> {
  const auth = await authorizationHeader()
  const body = new FormData()
  body.append('backup', file)
  const res = await fetch('/api/backup/restore', {
    method: 'POST',
    body,
    headers: { ...auth },
  })
  const text = await readResponseText(res)
  if (!res.ok) {
    throw new ApiHttpError(res.status, res.statusText, text)
  }
  return JSON.parse(text) as BackupRestoreResponse
}

/**
 * `POST /api/backup/restore/abort` — clear **`RESTORE_LOCK`** then staging (`api_contract.md` §6).
 */
export async function postBackupRestoreAbort(): Promise<BackupRestoreAbortResponse> {
  const auth = await authorizationHeader()
  const res = await fetch('/api/backup/restore/abort', {
    method: 'POST',
    headers: { ...auth },
  })
  const text = await readResponseText(res)
  if (!res.ok) {
    throw new ApiHttpError(res.status, res.statusText, text)
  }
  return JSON.parse(text) as BackupRestoreAbortResponse
}

const ABORT_RETRY_DELAYS_MS = [400, 800, 1200, 1600, 2000, 2400, 2800]

/**
 * Calls {@link postBackupRestoreAbort} and retries on **500** (partial staging cleanup — idempotent).
 */
export async function postBackupRestoreAbortWithRetries(
  maxAttempts = 8,
): Promise<BackupRestoreAbortResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await postBackupRestoreAbort()
    } catch (e) {
      lastError = e
      if (e instanceof ApiHttpError && e.status === 500) {
        const delayMs =
          ABORT_RETRY_DELAYS_MS[
            Math.min(attempt, ABORT_RETRY_DELAYS_MS.length - 1)
          ]
        if (attempt < maxAttempts-1) {
          await new Promise((r) => setTimeout(r, delayMs))
        }
        continue
      }
      throw e
    }
  }
  throw lastError
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
  | { accountId: string; currency: string; newAccountName?: never }
  | { accountId?: never; newAccountName: string; currency: string }

/**
 * `POST /api/imports` — multipart: **`file`**, **`currency`**, and either
 * **`account_id`** or **`new_account_name`** (see API contract).
 */
export async function postImport(
  file: File,
  account: PostImportAccount,
): Promise<ImportParseResult> {
  const auth = await authorizationHeader()
  const body = new FormData()
  body.append('file', file)
  body.append('currency', account.currency)
  if (typeof account.accountId === 'string') {
    body.append('account_id', account.accountId)
  } else {
    body.append('new_account_name', account.newAccountName)
  }
  const res = await fetch('/api/imports', {
    method: 'POST',
    body,
    headers: { ...auth },
  })
  const text = await readResponseText(res)
  if (!res.ok) {
    throw new ApiHttpError(res.status, res.statusText, text)
  }
  return JSON.parse(text) as ImportParseResult
}

export async function getMetrics(currency: string): Promise<MetricsResponse> {
  const code = currency.trim()
  return fetchJson<MetricsResponse>(
    `/api/metrics?currency=${encodeURIComponent(code)}`,
    { cache: 'no-store' },
  )
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
