import { useEffect, useState } from 'react'

import { getHealth, type HealthResponse } from '@/api/client'

function diagnosticLine(h: HealthResponse, label: string): string | null {
  const hint = h.diagnostic?.hint?.trim()
  const code = h.diagnostic?.code
  if (!hint) return null
  if (code && code !== 'OK') return `[${code}] ${hint}`
  if (label === 'unknown') return `[${code ?? '?'}] ${hint}`
  return null
}

/**
 * Public page: calls GET /api/health and shows DynamoDB-backed build label + diagnostics.
 */
export function HealthCheckPage() {
  const [message, setMessage] = useState<string>('Loading…')
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const h = await getHealth()
        if (cancelled) return
        const label =
          typeof h.build === 'string' && h.build.length > 0 ? h.build : 'unknown'
        setMessage(`hello from ${label}`)
        setDetail(diagnosticLine(h, label))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Request failed')
        setMessage('')
        setDetail(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="dashboard-ambient flex min-h-svh items-center justify-center px-4 py-12">
      <div className="max-w-xl text-center">
        <h1 className="mb-3 text-lg font-medium text-zinc-100">
          Health check
        </h1>
        {error ? (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : (
          <>
            <p className="text-base text-zinc-300">{message}</p>
            {detail ? (
              <p
                className="mt-4 text-left text-xs leading-relaxed text-zinc-500 sm:text-center"
                role="status"
              >
                {detail}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
