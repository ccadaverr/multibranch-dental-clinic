import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'

// M4 Patient record client. Laravel/PostgreSQL is the only authority for the non-clinical Patient profile: nothing here
// reads or writes browser storage, and a failure is returned as an explicit result — never a demo or "first" Patient.
// Clinical history (allergies, medical and dental history) has no server representation yet, so it is neither loaded nor
// sent. Ids are public ULIDs; the preferred branch uses its legacy_ref, like the rest of the reference API.

/** The fields a front-desk Staff account may maintain, in UI naming -> server naming. */
export const EDITABLE_FIELDS = {
  firstName: 'first_name', lastName: 'last_name', phone: 'phone', dob: 'date_of_birth', sex: 'sex',
  address: 'address', emergencyContact: 'emergency_contact', email: 'email', preferredBranchId: 'preferred_branch_id',
  hmoProviderName: 'hmo_provider_name', hmoMemberNumber: 'hmo_member_number',
}

/** Server record -> UI read model. Fields outside the viewer's tier stay undefined (not ''), so a restricted record is never shown as blank data. */
export function mapPatientRecord(row) {
  return {
    id: row.id, patientCode: row.code, name: row.name || '', firstName: row.first_name || '', lastName: row.last_name || '',
    dob: row.date_of_birth || '', phone: row.phone || '',
    // `identity` is the directory-level tier (no sex, email, address, emergency contact, branch or revision); `full` adds them.
    access: row.profile_access === 'full' ? 'full' : 'identity',
    sex: 'sex' in row ? row.sex || '' : undefined, emergencyContact: 'emergency_contact' in row ? row.emergency_contact || '' : undefined,
    email: 'email' in row ? row.email || '' : undefined, address: 'address' in row ? row.address || '' : undefined,
    preferredBranchId: 'preferred_branch' in row ? row.preferred_branch?.id ?? null : undefined,
    preferredBranch: 'preferred_branch' in row ? row.preferred_branch?.name ?? '' : undefined,
    hasPortalAccount: row.has_portal_account === true, revision: row.revision,
    hmoProviderName: 'hmo_provider_name' in row ? row.hmo_provider_name || '' : undefined,
    hmoMemberNumber: 'hmo_member_number' in row ? row.hmo_member_number || '' : undefined,
  }
}

/** Only the fields that differ from the loaded record, in server naming. An account holder's email is never sent (M1 owns it). */
export function changedFields(record, form) {
  const changes = {}
  for (const [ui, server] of Object.entries(EDITABLE_FIELDS)) {
    if (form[ui] === undefined || form[ui] === record[ui]) continue
    if (ui === 'email' && record.hasPortalAccount) continue
    const value = typeof form[ui] === 'string' ? form[ui].trim() : form[ui]
    if (value === (record[ui] ?? '')) continue
    changes[server] = value === '' && !['first_name', 'last_name'].includes(server) ? null : value
  }
  return changes
}

export async function loadPatientRecord(id, signal) {
  const result = await api.getPatientRecord(id, signal)
  if (!result.ok) return normalizeFailure(result)
  if (result.data?.id !== id || !['full','identity'].includes(result.data.profile_access)) return {ok:false,kind:'unverified',message:'The returned profile did not identify the selected Patient. No record was adopted.'}
  return { ok: true, record: mapPatientRecord(result.data) }
}

/** Saves the changed fields against the revision that was loaded; a 409 means someone else saved first. */
export async function savePatientRecord(record, form, {key,beforeDispatch} = {}) {
  if (record?.access !== 'full' || !Number.isSafeInteger(record.revision) || record.revision < 1) return {ok:false,kind:'forbidden',message:'This profile is not available for editing.'}
  const changes = changedFields(record, form)
  if (!Object.keys(changes).length) return { ok: true, unchanged: true, record }
  const result = await api.updatePatientRecordRemote(record.id, { ...changes, expected_revision: record.revision }, key, beforeDispatch)
  if (!result.ok) {
    const failure = normalizeFailure(result)
    return failure.kind === 'conflict' ? { ...failure, message: 'This patient record changed after you opened it. Reload it before saving again.' } : failure
  }
  if (result.data?.id !== record.id || result.data.profile_access !== 'full' ||
      result.data.revision !== record.revision + 1 && !(result.meta?.unchanged === true && result.data.revision === record.revision))
    return {ok:false,kind:'unverified',message:'The save response did not match this Patient and observed revision. The outcome is unconfirmed; review current records before another save.'}
  return { ok: true, unchanged:result.meta?.unchanged===true, record: mapPatientRecord(result.data) }
}

/** The read-only index of linked records: counts per family plus the families that have no server source yet. */
export async function loadPatientRecordIndex(id, signal) {
  const result = await api.getPatientRecordIndex(id, signal)
  if (!result.ok) return normalizeFailure(result)
  const d = result.data
  const families = ['appointments', 'visits', 'treatments', 'invoices', 'hmo_cases']
  if (d?.patient?.id !== id || families.some(f=>!Array.isArray(d[f]))) return {ok:false,kind:'unverified',message:'Linked records could not be verified for the selected Patient.'}
  return {
    ok: true,
    counts: Object.fromEntries(families.map(f => [f, Array.isArray(d[f]) ? d[f].length : 0])),
    limit: d.limit_per_list ?? null,
    unavailable: Array.isArray(d.unavailable) ? d.unavailable : [],
  }
}
