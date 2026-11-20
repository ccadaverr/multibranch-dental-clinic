// Deep links from the automation emails, applied after sign-in (kept for this tab only, like invoice-link.js):
//   /?appointment=<public id>#sign-in   Patient: My visits, focused on that appointment (reschedule or cancel there)
//   /?open=book#sign-in                 Patient: Book a visit
//   /?open=reports#sign-in              Owner: Analytics & Reports
// The server still decides whether the appointment belongs to the person signing in.
const KEY = 'dentalops-v4-page-link'
const ID = /^[0-9a-z]{26}$/i
const PAGES = ['book', 'reports']
const bookingRef = value => typeof value === 'string' && /^[a-z0-9-]{1,50}$/i.test(value) ? value : null

export function publicBookingLink({ service, branch } = {}) {
  const params = new URLSearchParams({ open: 'book' })
  if (bookingRef(service)) params.set('service', service)
  if (bookingRef(branch)) params.set('branch', branch)
  return `/?${params}#sign-in`
}

const bookLink = (service, branch) => {
  const link = { page: 'book' }
  if (bookingRef(service)) link.service = service
  if (bookingRef(branch)) link.branch = branch
  return link
}

export function readPageLink(search) {
  let params
  try { params = new URLSearchParams(search || '') } catch { return null }
  const appointmentId = (params.get('appointment') || '').trim()
  if (ID.test(appointmentId)) return { appointmentId: appointmentId.toLowerCase() }
  const page = (params.get('open') || '').trim()
  if (page === 'book') return bookLink(params.get('service'), params.get('branch'))
  return PAGES.includes(page) ? { page } : null
}

export function rememberPageLink(link, storage = globalThis.sessionStorage) {
  if (!link) return
  try { storage?.setItem(KEY, JSON.stringify(link)) } catch { /* storage unavailable */ }
}

/** Returns the remembered link once and forgets it. */
export function takePageLink(storage = globalThis.sessionStorage) {
  let raw = null
  try { raw = storage?.getItem(KEY) ?? null; storage?.removeItem(KEY) } catch { return null }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.page === 'book' && !parsed.appointmentId) return bookLink(parsed.service, parsed.branch)
    return readPageLink(parsed?.appointmentId ? `?appointment=${encodeURIComponent(parsed.appointmentId)}` : `?open=${encodeURIComponent(parsed?.page || '')}`)
  } catch { return null }
}

/** Where a link opens for a role: [page, context] or null when the link is not for this role. */
export function pageForLink(link, role) {
  if (!link) return null
  if (role === 'patient' && link.appointmentId) return ['visits', { appointmentId: link.appointmentId }]
  if (role === 'patient' && link.page === 'book') return ['book', link.service || link.branch ? { service: link.service, branch: link.branch } : null]
  if (role === 'owner' && link.page === 'reports') return ['analytics', null]
  return null
}

export function clearPageLinkFromUrl(win = globalThis.window) {
  try {
    const url = new URL(win.location.href)
    if (!url.searchParams.has('appointment') && !url.searchParams.has('open')) return
    url.searchParams.delete('appointment')
    url.searchParams.delete('open')
    url.searchParams.delete('service')
    url.searchParams.delete('branch')
    url.hash = ''
    win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}`)
  } catch { /* nothing to clean */ }
}
