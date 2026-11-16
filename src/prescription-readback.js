import {boundedClinicalRead} from './clinical-history.js'

export const prescriptionContextMatches = (row, context) => !!context?.patientId && !!context.visitId && !!context.branchId &&
  row?.patient?.id === context.patientId && row.visit === context.visitId && row.branch_id === context.branchId

export async function readEncounterPrescriptions(read, context) {
  if (!context?.patientId || !context.visitId || !context.branchId) return {ok:false, message:'The encounter identity is unavailable. No prescriptions were loaded.'}
  const r = await boundedClinicalRead(() => read({patient_id:context.patientId, visit_id:context.visitId}))
  if (!r?.ok) return r
  if (!Array.isArray(r.data) || r.data.length >= 200 || r.data.some(p => !prescriptionContextMatches(p, context) || !p.id ||
    !['Draft','Issued','Void'].includes(p.status) || !Number.isSafeInteger(p.revision) || p.revision < 1 ||
    p.status !== 'Draft' && (typeof p.number !== 'string' || !p.number.trim())) || new Set(r.data.map(p=>p.id)).size !== r.data.length) {
    return {ok:false, message:'The prescription list did not confirm this exact encounter or a complete result. No records were adopted.'}
  }
  return r
}
