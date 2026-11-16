import { apiBase } from './api-client.js'

const errors = {
  401: 'Your clinic session expired. Sign in and try again.',
  403: 'This export is restricted to the clinic Owner.',
  404: 'This export is unavailable.',
  409: 'The export context changed. Review the current filters and try again.',
  422: 'The export filters are not valid. Adjust them and try again.',
}

function csvFilename(disposition, fallback) {
  const encoded = /(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i.exec(disposition)?.[1]
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition)
  let decoded
  if (encoded) {
    try { decoded = decodeURIComponent(encoded.trim()) } catch { /* Use the plain name when supplied. */ }
  }
  return [decoded, plain?.[1] ?? plain?.[2]].map(name => name?.trim())
    .find(name => name && name.length <= 180 && /^[\p{L}\p{N}][\p{L}\p{N} _.-]*\.csv$/iu.test(name)) || fallback
}

/** Retrieve an authenticated clinic CSV. The caller owns request identity and the decision to save. */
export async function requestClinicCsv(path, params, { signal, fallbackFilename, failureMessage = 'Failed to export clinic records.' }) {
  signal?.throwIfAborted()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, value)
  }

  let response
  try {
    response = await fetch(`${apiBase()}${path}${query.size ? `?${query}` : ''}`, {
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json, text/csv' },
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
    throw new Error('Could not reach the clinic system. Check your connection and try again.', { cause: error })
  }

  signal?.throwIfAborted()
  if (!response.ok) {
    throw Object.assign(new Error(errors[response.status] || failureMessage), { status: response.status })
  }
  const getHeader = name => response.headers.get(name)
  if (!/^text\/csv(?:\s*;|$)/i.test(getHeader('Content-Type') || '')) {
    throw new Error('The clinic server did not return a CSV file.')
  }
  let blob
  try {
    blob = await response.blob()
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
  signal?.throwIfAborted()
  const limit = Number(getHeader('X-Audit-Export-Limit'))
  return {
    blob,
    filename: csvFilename(getHeader('Content-Disposition') || '', fallbackFilename),
    truncated: getHeader('X-Audit-Export-Truncated') === 'true',
    limit: Number.isSafeInteger(limit) && limit > 0 ? limit : null,
  }
}

/** Call only after confirming that this payload still belongs to the active export. */
export function saveClinicCsv({ blob, filename }) {
  const link = document.createElement('a')
  const url = window.URL.createObjectURL(blob)
  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.URL.revokeObjectURL(url)
  }
}
