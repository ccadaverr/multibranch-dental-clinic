import {boundedClinicalRead} from '../clinical-history.js'

const text=value=>typeof value==='string'&&!!value.trim()
const optionalText=value=>value==null||typeof value==='string'
const timestamp=value=>text(value)&&Number.isFinite(Date.parse(value))

/** Verify the current Patient/dependent scope before adopting any clinical text. */
export async function readPatientPrescriptions(read, family, patientId, isCurrent, timeoutMs=30000) {
  if (!patientId || !isCurrent()) return {ok:false, message:'Your prescription session is unavailable. Sign in again.'}
  let active=true
  try {
    return await boundedClinicalRead(async () => {
      const [r, f] = await Promise.all([read(), family()])
      if (!active || !isCurrent()) return {ok:false, kind:'stale_context'}
      if (!r?.ok || !f?.ok) return {ok:false, kind: !r?.ok ? r?.kind : f?.kind,
        message:r?.message || f?.message || 'Your prescriptions could not be verified. Retry to read saved records.'}
      if (f.meta?.me?.id !== patientId || !Array.isArray(f.data) || f.data.some(p => typeof p?.id !== 'string' || !p.id.trim())) return {ok:false, kind:'unverified', message:'Your authorized patient records could not be verified. Retry to read saved records.'}
      const allowed=new Set([patientId, ...f.data.map(p=>p.id)])
      if (!Array.isArray(r.data) || new Set(r.data.map(p=>p?.id)).size!==r.data.length || r.data.some(p =>
        !text(p?.id) || !allowed.has(p.patient?.id) || !optionalText(p.patient.name) || !text(p.visit) || !text(p.branch_id) ||
        !text(p.branch) || !optionalText(p.dentist) || !optionalText(p.note) ||
        !['Issued','Void'].includes(p.status) || !text(p.number) || !timestamp(p.issued_at) || !Number.isSafeInteger(p.revision) || p.revision<1 ||
        (p.status==='Void' && !p.voided) || (p.voided!=null && (!timestamp(p.voided.at) || !text(p.voided.reason))) ||
        !Array.isArray(p.lines) || p.lines.some(l=>!text(l?.medicine) ||
          !['dosage','frequency','duration','instructions'].every(field=>optionalText(l[field]))))) {
        return {ok:false, kind:'unverified', message:'The returned prescriptions did not confirm your Patient and visit identities. No records were adopted.'}
      }
      const complete = r.data.filter(p => p.lines.length > 0)
      return { ...r, data: complete, unavailableCount: r.data.length - complete.length }
    },timeoutMs)
  } finally { active=false }
}
