import {boundedClinicalRead} from './clinical-history.js'

/** Explicit paged reads; never adopt an unverified page as an empty search. */
export async function readPrescriptionPage(read, query, role) {
  if (!['dentist','staff','owner'].includes(role) || !Number.isSafeInteger(query?.page) || query.page<1 ||
    !Number.isSafeInteger(query?.per_page) || query.per_page<1 || query.per_page>100 || query.visit_id && !query.patient_id) {
    return {ok:false, message:'The prescription search context is unavailable.'}
  }
  const r = await boundedClinicalRead(() => read(query))
  if (!r?.ok) return r || {ok:false, message:'The prescription page could not be read. Reload to try again.'}
  const m = r.meta
  const valid = m && Number.isSafeInteger(m.current_page) && m.current_page === query.page &&
    Number.isSafeInteger(m.per_page) && m.per_page === query.per_page &&
    Number.isSafeInteger(m.total) && m.total >= 0 && Number.isSafeInteger(m.last_page) &&
    m.last_page === Math.max(1, Math.ceil(m.total / m.per_page)) &&
    Array.isArray(r.data) && r.data.length === Math.max(0, Math.min(m.per_page, m.total - (m.current_page - 1) * m.per_page)) &&
    new Set(r.data.map(p => p?.id)).size === r.data.length && r.data.every(p =>
      typeof p?.id === 'string' && p.id.trim() && ['Draft','Issued','Void'].includes(p.status) &&
      Number.isSafeInteger(p.revision) && p.revision > 0 && (p.status === 'Draft' || typeof p.number === 'string' && p.number.trim()) &&
      (!query.status || query.status === p.status) &&
      (role === 'owner' ? p.status !== 'Draft' && !['patient','visit','lines','note'].some(k => Object.hasOwn(p,k)) :
        !!p.patient?.id && !!p.visit && !!p.branch_id && (!query.patient_id || p.patient.id === query.patient_id) &&
        (!query.visit_id || p.visit === query.visit_id) && (role === 'dentist' || role === 'staff' && p.status !== 'Draft')))
  return valid ? r : {ok:false, message:'The prescription page could not be verified. Reload before opening a record.'}
}
