// Clinical intent stays in memory. The server's encrypted command journal owns durable recovery.
const fields = ['medicine', 'dosage', 'frequency', 'duration', 'instructions']
const text = value => String(value ?? '').trim()
const content = value => JSON.stringify({ lines: (value.lines || []).map(l => ({
  ...Object.fromEntries(fields.map(f => [f, text(l[f])])),
  value_origins: Object.fromEntries(fields.filter(f => l.value_origins?.[f]).map(f => [f, l.value_origins[f]])),
})), note: text(value.note) })
export function unchangedPrescriptionDraft(row, request) {
  return [request.visitId,request.patientId,request.branch].every(value=>typeof value==='string'&&!!value.trim()) &&
    !!row?.id && Number.isSafeInteger(row.revision) && row.revision > 0 && row.status === 'Draft' && row.can_edit === true &&
    !row.number && row.visit === request.visitId && row.patient?.id === request.patientId && row.branch === request.branch &&
    content(row) === content(request.body)
}
export function prescriptionWriteMatches(row, request, issued = false) {
  if (![request.visitId,request.patientId,request.branch].every(value => typeof value === 'string' && !!value.trim())) return false
  const base = request.acceptedDraft || request.base
  if (!row?.id || !Number.isSafeInteger(row.revision) || row.visit !== request.visitId || row.patient?.id !== request.patientId || row.branch !== request.branch || content(row) !== content(request.body)) return false
  if (!issued) return row.status === 'Draft' && row.can_edit === true && (!request.base || row.id === request.base.id) && row.revision === (request.base?.revision || 0) + 1 && !row.number
  return row.id === base?.id && row.status === 'Issued' && row.revision === base.revision + 1 && /^RX-\d{4}-\d{6,}$/.test(row.number || '') && !!row.issued_at && row.can_edit === false && row.can_void === true
}
export async function runPrescriptionWrite(request, api, allowed) {
  const unknown = message => ({ ok: false, kind: 'unconfirmed', message, retryable: true })
  try {
    if (!allowed()) return {ok:false, kind:'auth_changed', message:'Your session changed. Review the prescription after signing in.'}
    if (!request.acceptedDraft) {
      // A restored unchanged Draft still needs an authoritative identity/revision read,
      // but no Update. Issue retains the reviewed revision and its original command key.
      if (request.issue && unchangedPrescriptionDraft(request.base, request)) {
        const current = await api.read(request.base.id)
        if (!allowed()) return {ok:false, kind:'auth_changed', message:'Your session changed. Issuance was not started.'}
        if (!current.ok) return {...current, retryable:['network','server'].includes(current.kind)}
        if (!unchangedPrescriptionDraft(current.data, request) || current.data.id !== request.base.id || current.data.revision !== request.base.revision) {
          return {ok:false, kind:'conflict', message:'The saved Draft changed or is no longer editable. Reload the Draft and review it before issuing.'}
        }
        request.acceptedDraft = current.data
      } else {
        const r = request.base
          ? await api.update(request.base.id, {...request.body, expected_revision:request.base.revision}, request.saveKey, allowed)
          : await api.create({visit_id:request.visitId, ...request.body}, request.saveKey, allowed)
        if (!r.ok) return {...r, retryable:['network','server'].includes(r.kind)}
        if (!prescriptionWriteMatches(r.data, request)) return unknown('The saved Draft did not match the reviewed Patient, visit or medicines. Reload or retry the same request.')
        request.acceptedDraft = r.data
      }
    }
    let accepted = request.acceptedDraft
    if (request.issue) {
      if (!allowed()) return {ok:false, kind:'auth_changed', message:'The Draft was saved. Issuance was not started because your session changed. Review the Draft after signing in.'}
      const r = await api.issue(accepted.id, accepted.revision, request.issueKey, allowed)
      if (!r.ok) return {...r, retryable:['network','server'].includes(r.kind)}
      if (!prescriptionWriteMatches(r.data, request, true)) return unknown('The Issue response did not confirm this prescription. Reload or retry the same request.')
      accepted = r.data
    }
    if (!allowed()) return {ok:false, kind:'auth_changed', message:'Your session changed. Check the saved prescription after signing in.'}
    const current = await api.read(accepted.id)
    if (!current.ok || !prescriptionWriteMatches(current.data, request, request.issue) || current.data.id !== accepted.id || current.data.number !== accepted.number) return unknown('The saved prescription could not be verified. Retry the same request or reload before continuing.')
    return current
  } catch { return unknown('The prescription outcome is unknown. Retry the same request or reload; do not create a second prescription.') }
}
