import { useEffect, useState } from 'react'

// Each section keeps its own result and retry, bound to the current report and session.
export function useOwnerReportSection(fetchSection, { enabled, context, period, dateFrom, dateTo, branchId, isCurrent }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    setResult({ context, attempt, status: 'loading' })
    fetchSection({ period, date_from: dateFrom, date_to: dateTo, branch_id: branchId }).then(data => {
      if (active && isCurrent()) setResult({ context, attempt, status: 'ready', data })
    }, error => {
      if (!active || !isCurrent()) return
      const denied = error?.kind === 'unauthenticated' || error?.kind === 'forbidden'
      setResult({ context, attempt, status: denied ? 'denied' : 'error' })
    })
    return () => { active = false }
  }, [fetchSection, enabled, context, period, dateFrom, dateTo, branchId, attempt, isCurrent])

  const current = enabled && result?.context === context && result.attempt === attempt ? result : null
  return { status: enabled ? (current?.status || 'loading') : 'idle', data: current?.data, retry: () => setAttempt(value => value + 1) }
}
