// Public presentation data only; never used for M2 authorization or scheduling.
// Only the clinic's name and contact live here, as the fallback when the server cannot be reached. Branches (names, addresses,
// map pins) come from the clinic records through GET /api/public/branches (docs/BRANCH_LOCATIONS.md).
// White-label (decision 12): the identity and contact fields below are the FALLBACK only. At startup main.jsx calls
// loadBranding(), which replaces them with the Owner's settings from GET /api/branding before the first render; renders without
// the API (smoke tests, an unreachable server) keep these defaults.
export const clinic = {
  name: 'Dr. Dana E. Roxas Dental Clinic',
  nameLine: 'Dr. Dana E. Roxas',
  subtitle: 'Dental Clinic',
  locationLabel: 'Dr. Dana E. Roxas Dental Clinic - Bocaue, Bulacan',
  city: 'Bocaue, Bulacan',
  phoneDisplay: '0922 878 7341',
  phoneE164: '+639228787341',
  email: 'danaroxas.dentalclinic@gmail.com',
  logo: '/images/logo.png',
}

/** Applies the public branding (GET /api/branding) to `clinic`. Unknown or empty values keep the fallback. */
export function applyBranding(data) {
  if (!data || typeof data !== 'object') return clinic
  const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const set = (key, value) => { if (value) clinic[key] = value }
  set('name', text(data.name))
  set('nameLine', text(data.name_line))
  set('subtitle', text(data.subtitle))
  set('city', text(data.address))
  set('email', text(data.email))
  const phone = text(data.phone)
  if (phone) {
    clinic.phoneDisplay = phone
    const digits = phone.replace(/[^0-9+]/g, '')
    clinic.phoneE164 = digits.startsWith('+') ? digits : digits.startsWith('0') ? `+63${digits.slice(1)}` : digits
  }
  if (text(data.name) || text(data.address)) clinic.locationLabel = [clinic.name, clinic.city].filter(Boolean).join(' - ')
  // Only an uploaded logo replaces the supplied one; otherwise the official /images/logo.png stays (full resolution).
  if (data.logo_custom === true && typeof data.logo_url === 'string' && /^https?:\/\//.test(data.logo_url)) clinic.logo = data.logo_url
  return clinic
}

let publicApiBase = 'http://localhost:8000'

/** GET a public (no sign-in) list from the clinic server: {ok, rows}. Never a built-in fallback list. */
export async function loadPublicList(path, timeoutMs = 6000) {
  if (typeof fetch !== 'function') return { ok: false, rows: [] }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), timeoutMs)
  try {
    const response = await fetch(`${publicApiBase.replace(/\/$/, '')}/api/public/${path}`, { headers: { Accept: 'application/json' }, signal: controller?.signal })
    const rows = response.ok ? (await response.json())?.data : null
    return Array.isArray(rows) ? { ok: true, rows } : { ok: false, rows: [] }
  } catch { return { ok: false, rows: [] } } finally { clearTimeout(timer) }
}

/** The open branches for the public website, from the clinic records. {ok, branches} — never a built-in list. */
export async function loadPublicBranches(timeoutMs = 6000) {
  const { ok, rows } = await loadPublicList('branches', timeoutMs)
  if (!ok) return { ok: false, branches: [] }
  const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null)
  return { ok: true, branches: rows.filter(b => b && typeof b.name === 'string' && typeof b.address === 'string').map(b => ({ id: String(b.id), number: String(b.number || ''), name: b.name, address: b.address,
    latitude: Number.isFinite(b.latitude) && Math.abs(b.latitude) <= 90 ? b.latitude : null,
    longitude: Number.isFinite(b.longitude) && Math.abs(b.longitude) <= 180 ? b.longitude : null,
    phone: text(b.phone), email: text(b.email), weeklyHours: b.weekly_hours && typeof b.weekly_hours === 'object' && !Array.isArray(b.weekly_hours) ? b.weekly_hours : null,
    developmentCatalog: b.development_catalog === true, services: Array.isArray(b.services) ? b.services.filter(s => text(s?.id) && text(s?.name)) : [] })) }
}

/** Fetches the public branding once at startup; never blocks the app for more than `timeoutMs`. */
export async function loadBranding(apiBase, timeoutMs = 2500) {
  publicApiBase = apiBase || publicApiBase
  if (typeof fetch !== 'function') return clinic
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), timeoutMs)
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/branding`, { headers: { Accept: 'application/json' }, credentials: 'include', signal: controller?.signal })
    if (response.ok) applyBranding((await response.json())?.data)
  } catch { /* offline or slow: the fallback stays */ } finally { clearTimeout(timer) }
  if (typeof document !== 'undefined') applyDocumentMeta()
  return clinic
}

/** Title, description, Open Graph tags and favicon from the branding settings (index.html holds only a generic fallback). */
export function applyDocumentMeta(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return
  const description = `Book visits, pay online and message ${clinic.name} in one place.`
  const logo = /^https?:/.test(clinic.logo) ? clinic.logo : `${doc.location?.origin || ''}${clinic.logo}`
  doc.title = clinic.name
  const meta = (attr, key, content) => {
    let el = doc.head.querySelector(`meta[${attr}="${key}"]`)
    if (!el) { el = doc.createElement('meta'); el.setAttribute(attr, key); doc.head.appendChild(el) }
    el.setAttribute('content', content)
  }
  meta('name', 'description', description)
  meta('property', 'og:type', 'website')
  meta('property', 'og:title', clinic.name)
  meta('property', 'og:description', description)
  meta('property', 'og:image', logo)
  const icon = doc.head.querySelector('link[rel="icon"]')
  if (icon) icon.setAttribute('href', clinic.logo)
}
