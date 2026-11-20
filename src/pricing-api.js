import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'

// M13 pricing client. Laravel/PostgreSQL holds the ONLY authoritative prices: Owner-confirmed, effective-dated,
// append-only versions (service_prices). `services.reference_fee_php` (the browser's `baseFee`) is reference/demo data
// and is never sent, copied or pre-filled here. Amounts travel as decimal STRINGS ("1500.00"); this module never does
// arithmetic on them. The current browser billing prototype does not use this module (it changes at the M11 cutover).

const AMOUNT = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/

/** Server price version -> read model (public ids / legacy refs only). */
export function mapPriceVersion(row) {
  return {
    id: row.id,
    serviceId: row.service?.id ?? null,
    serviceName: row.service?.name ?? '',
    branchId: row.branch?.id ?? null,
    branchName: row.branch?.name ?? '',
    level: row.level,
    kind: row.kind,
    amount: row.amount ?? null,
    effectiveFrom: row.effective_from,
    source: row.source,
    developmentSample: row.development_sample === true,
    createdAt: row.created_at,
    createdBy: row.created_by?.name ?? '',
    retractedAt: row.retracted_at ?? null,
    retractedBy: row.retracted_by?.name ?? '',
  }
}

/** Presentation status of a version on `today` (Asia/Manila): Retracted, Scheduled, In effect or Superseded. */
export function versionStatus(version, versions, today) {
  if (version.retractedAt) return 'Retracted'
  if (version.effectiveFrom > today) return 'Scheduled'
  const sameLevel = versions.filter(v => !v.retractedAt && v.serviceId === version.serviceId && v.branchId === version.branchId && v.effectiveFrom <= today)
  const latest = sameLevel.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a), sameLevel[0])
  return latest?.id === version.id ? 'In effect' : 'Superseded'
}

/** The version in effect today at one level (base: branchId null), or null. Display only — billing uses the server resolver. */
export function inEffect(versions, serviceId, branchId, today) {
  return versions.find(v => v.serviceId === serviceId && v.branchId === branchId && versionStatus(v, versions, today) === 'In effect') || null
}

/** Formats a decimal string as pesos without binary floating-point arithmetic. */
export function formatAmount(amount) {
  if (typeof amount !== 'string' || !AMOUNT.test(amount)) return '—'
  const [whole, cents = ''] = amount.split('.')
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents.padEnd(2, '0')}`
}

/** Client pre-check mirroring the server rule (the server validates again): decimal text, at most 2 decimals, > 0. */
export function validAmount(text) {
  const value = String(text ?? '').trim()
  return AMOUNT.test(value) && !/^0(\.0{1,2})?$/.test(value)
}

const PAGE_SIZE = 100
const MAX_PAGES = 20

/**
 * Price versions, newest first, read through the server cursor. The automatic fetch is bounded; when it stops with more history
 * on the server, `nextCursor` is returned so the Owner can continue (`loadPriceVersions(nextCursor)`) and the page never claims
 * the history is complete. A failed page is an error, never a shorter list.
 */
export async function loadPriceVersions(startCursor = null) {
  const versions = []
  let cursor = startCursor
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api.listServicePrices({ per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
    if (!result.ok) return normalizeFailure(result)
    versions.push(...(result.data || []).map(mapPriceVersion))
    cursor = result.meta?.next_cursor ?? null
    if (!cursor) return { ok: true, versions, nextCursor: null }
  }
  return { ok: true, versions, nextCursor: cursor }
}

/** Creates a new version. `source` and the author are assigned by the server and are never sent. */
export async function createPriceVersion({ serviceId, branchId = null, kind, amount = null, effectiveFrom }, key) {
  const payload = { kind, effective_from: effectiveFrom }
  if (branchId) payload.branch_ref = branchId
  if (kind === 'priced') payload.amount = String(amount).trim()
  const result = await api.createServicePrice(serviceId, payload, key)
  return result.ok ? { ok: true, version: mapPriceVersion(result.data) } : priceFailure(result)
}

export async function retractPriceVersion(version, key) {
  const result = await api.retractServicePrice(version.id, key)
  return result.ok ? { ok: true, version: mapPriceVersion(result.data) } : priceFailure(result)
}

/** The server-resolved price (Owner: any date; Staff: today only, own branches). */
export async function resolvePrice({ serviceId, branchId, date = null }) {
  const result = await api.resolveServicePrice({ service_ref: serviceId, branch_ref: branchId, date })
  return result.ok ? { ok: true, resolution: result.data } : normalizeFailure(result)
}

const priceFailure = result => {
  const failure = normalizeFailure(result)
  if (failure.code === 'price_version_exists') failure.message = 'A price version already starts on that date at this level. Choose another date, or retract the scheduled version first.'
  return failure
}
