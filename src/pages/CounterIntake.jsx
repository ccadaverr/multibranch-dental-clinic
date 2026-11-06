import React, { useEffect, useState } from 'react'
import { Button, Card, Field, Modal } from '../components.jsx'
import { dentistName } from '../logic.js'
import { branchPosterUrl, cancelIntake, confirmIntake, getPatientRecord, intakeCode, pendingIntake, offerOnlineAccount, refreshIntakeCode, requestHandover, verifyPatientId } from '../api-client.js'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work. Refresh and try again.'
const FIELDS = [['first_name', 'First name'], ['last_name', 'Last name'], ['date_of_birth', 'Date of birth', 'date'], ['sex', 'Sex'], ['phone', 'Mobile'], ['email', 'Email'], ['address', 'Address']]
const age = dob => { if (!dob) return null; const b = new Date(`${dob}T00:00:00Z`), n = new Date(); let a = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--; return a }

/** Front desk: today's counter code (for the patients' phones) and the poster. */
export function CounterCode({ toast = () => {} }) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(null), [attempt, setAttempt] = useState(0)
  useEffect(() => { setFailed(null); intakeCode().then(r => { if (r.ok) setData(r.data); else setFailed(r.kind) }) }, [attempt])
  if (failed === 'forbidden') return null // no counter for this account (for example no branch assigned)
  if (!data) return <Card className="ci-code" title="Counter registration">
    {failed ? <p role="alert">Today’s code could not be loaded. <button type="button" className="link-button" onClick={() => setAttempt(a => a + 1)}>Try again</button></p>
      : <p className="au-muted" role="status">Loading today’s code…</p>}</Card>
  const refresh = async () => {
    setBusy(true)
    const r = await refreshIntakeCode(data.branch.id)
    setBusy(false)
    if (r.ok) { setData(d => ({ ...d, ...r.data })); toast('New code. The old one no longer works.', 'success') } else toast(firstError(r), 'warning')
  }
  return <Card className="ci-code" title="Counter registration" subtitle={`${data.branch.name} · patients scan the counter poster`}>
    <p className="ci-code-label">Today’s code</p>
    <p className="ci-code-value" aria-live="polite">{data.code}</p>
    <p className="au-muted">Patients type it to join today’s queue, so nobody can join from home. It changes every day.</p>
    <div className="au-actions">
      <Button size="sm" variant="soft" disabled={busy} onClick={refresh}>New code</Button>
      <a className="btn ghost sm" href={branchPosterUrl(data.branch.id)} target="_blank" rel="noreferrer"><span>Counter poster (PDF)</span></a>

    </div>
  </Card>
}

/**
 * Self-registered patients waiting for the front desk ("Self-registered: verify ID"), on the Check-In page and the queue.
 * Every field is filled in by the patient; staff check the physical ID, correct anything (audited) and confirm. A possible
 * existing patient from ANY branch is shown ("Record found from Branch X") with "Use this record"; nothing is merged by itself.
 */
export function SelfRegistered(props) {
  const session = props.store?.session
  // Observed account/scope changes remount the whole review owner. Returning to
  // the same account never reuses an earlier dialog instance.
  const identity = JSON.stringify([session?.serverUserId, session?.role, session?.userId, session?.branchId, session?.branchScopes])
  return <SelfRegisteredBody key={identity} {...props}/>
}

function SelfRegisteredBody({ toast = () => {}, compact = false, onChanged, store }) {
  const [rows, setRows] = useState([]), [idTypes, setIdTypes] = useState({}), [open, setOpen] = useState(null)
  const live = React.useRef(false), selected = React.useRef(null), sequence = React.useRef(0), loadGeneration = React.useRef(0)
  React.useLayoutEffect(() => {
    live.current = true
    return () => { live.current = false; selected.current = null }
  }, [])
  const load = async () => {
    if (!live.current) return
    const generation = ++loadGeneration.current
    let r
    try { r = await pendingIntake() } catch { return }
    if (live.current && generation === loadGeneration.current && r.ok) { setRows(r.data || []); setIdTypes(r.meta?.id_types || {}) }
  }
  const current = selection => live.current && selected.current === selection
  const close = selection => { if (current(selection)) { selected.current = null; setOpen(null) } }
  const review = row => {
    if (!live.current) return
    const selection = {row, instance: ++sequence.current}
    selected.current = selection; setOpen(selection)
  }
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 15000)
    return () => clearInterval(t)
  }, [])
  if (!rows.length && !open) return null
  const name = s => (s.channel === 'account' ? s.account?.visit_for_name || s.account?.name : `${s.self?.first_name || ''} ${s.self?.last_name || ''}`.trim())
  return <Card className="ci-self" title={`Self-registered: verify ID (${rows.length})`} subtitle="Filled in by the patient on their phone. Check the ID, then confirm.">
    <ul className="fd-list">{rows.map(s => {
      const minorDep = (s.dependents || []).find((d, i) => s.visit_for === `dependent:${i}`)
      return <li key={s.id}>
        <div><b>{name(s)}{s.join_queue && <span className="fd-badge is-info">Joining today’s queue</span>}{s.duplicates?.length > 0 && <span className="fd-badge is-late">Possible existing patient</span>}
          {(minorDep?.minor || s.account?.visit_for_minor) && <span className="fd-badge is-late">Minor: guardian {s.channel === 'account' ? s.account?.name : `${s.self?.first_name} ${s.self?.last_name}`}</span>}</b>
          <span>{s.time} · {s.reference} · {s.channel === 'account' ? 'signed in with their account' : 'own phone'}{s.id_type ? ` · scanned ${idTypes[s.id_type] || s.id_type}` : ''}{minorDep ? ` · visit for ${minorDep.first_name}` : ''}</span></div>
        {!compact && <Button size="sm" onClick={() => review(s)}>Review and confirm</Button>}
      </li>
    })}</ul>
    {open && <ReviewDialog key={open.instance} row={open.row} reviewInstance={open} isCurrent={() => current(open)} idTypes={idTypes} toast={toast} store={store} onClose={() => close(open)} onDone={() => {
      if (!current(open)) return
      close(open); load(); onChanged?.()
    }}/>}
  </Card>
}

function ReviewDialog({ row, reviewInstance, isCurrent, idTypes, toast, onClose, onDone, store }) {
  const live = React.useRef(false), command = React.useRef(null)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const account = row.channel === 'account'
  const [fields, setFields] = useState(() => ({ ...(row.self || {}) }))
  const [use, setUse] = useState(''), [idType, setIdType] = useState(row.id_type || 'philid'), [idOther, setIdOther] = useState(''), [idChecked, setIdChecked] = useState(false), [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const [idOtherTouched, setIdOtherTouched] = useState(false)
  // A walk-in enters a Dentist's queue only with a responsible Dentist (existing rule): choose the service and the Dentist.
  const state = store?.state || {}
  const services = (state.services || []).filter(sv => sv.status === 'Active' && (state.branchServices || []).some(bs => bs.branchId === row.branch_ref && bs.serviceId === sv.id && bs.active !== false))
  const [serviceId, setServiceId] = useState(''), [dentistId, setDentistId] = useState('')
  const dentists = (state.dentists || []).filter(d => (d.branchIds || []).includes(row.branch_ref) && (!serviceId || (d.serviceIds || []).includes(serviceId)) && d.available !== false)
  const corrections = Object.fromEntries(FIELDS.map(([k]) => k).filter(k => (fields[k] ?? '') !== (row.self?.[k] ?? '')).map(k => [k, fields[k] || null]))
  const confirm = async () => {
    if (!live.current || !isCurrent() || command.current) return
    if (idChecked && idType === 'other' && !idOther.trim()) { setIdOtherTouched(true); return }
    const payload = { use_patient: use || null, corrections: use ? {} : corrections, id_verified: idChecked, id_type: idType, ...(idType === 'other' ? { other_details: idOther.trim() } : {}),
      ...(row.join_queue && serviceId ? { service_ref: serviceId } : {}), ...(row.join_queue && serviceId && dentistId ? { dentist_ref: dentistId } : {}) }
    await submit('confirm', payload)
  }
  const submit = async (action, payload) => {
    if (!live.current || !isCurrent() || command.current) return
    const request = {rowId: row.id, reference: row.reference, payload, reviewInstance, action}
    command.current = request
    setBusy(action); setErr('')
    let r
    try { r = action === 'confirm' ? await confirmIntake(request.rowId, request.payload) : await cancelIntake(request.rowId) }
    catch { r = {ok: false, message: 'The registration result could not be confirmed. Check the pending list before retrying.'} }
    // Dismissal only ends UI adoption; it cannot cancel a transmitted command.
    if (!live.current || !isCurrent() || command.current !== request) return
    command.current = null; setBusy('')
    if (!r.ok) return setErr(firstError(r))
    if (r.data?.reference !== request.reference || r.data?.status !== (action === 'confirm' ? 'confirmed' : 'cancelled') || (action === 'confirm' && !r.data?.patient?.id)) {
      return setErr('The registration result could not be matched. Check the pending list before retrying.')
    }
    // visit_id proves admission, not queue placement (a walk-in can be unassigned).
    if (action === 'confirm') toast(`${r.data.patient.name} (${r.data.patient.code}) confirmed${r.data.visit_id ? ' and checked in' : ''}.`, 'success')
    else toast('Registration removed.', 'success')
    onDone()
  }
  const cancel = () => submit('cancel')
  const holder = account ? row.account?.name : `${row.self?.first_name} ${row.self?.last_name}`
  return <Modal open wide title={`Confirm ${row.reference}`} subtitle={account ? `${holder} signed in with their account` : 'Check the details against the ID. Correct anything here instead of retyping.'} onClose={onClose}>
    <fieldset disabled={!!busy} aria-busy={!!busy} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}><legend className="sr-only">Registration details</legend>
    {!account && row.duplicates?.length > 0 && <div className="ci-dupes" role="region" aria-label="Possible existing patient">
      <p><b>Possible existing patient</b> (same name and birth date, and the same phone or email). Nothing is merged automatically.</p>
      {row.duplicates.map(d => <label key={d.patient_id} className="ci-dupe"><input type="radio" name="use" checked={use === d.patient_id} onChange={() => setUse(d.patient_id)}/>
        <span><b>{d.name}</b> · {d.code} · <b>Record found from {d.found_from || 'this clinic'}</b>{d.has_account ? ' · has an online account' : ''}{d.id_verified ? ' · ID checked before' : ''}</span>
        {d.found_from && <Button size="sm" variant="ghost" onClick={async e => { e.preventDefault(); const r = await requestHandover(d.patient_id); if (!live.current || !isCurrent()) return; toast(r.ok ? `Asked ${r.data.branch} to send a handover (${r.data.asked} team member(s) told).` : firstError(r), r.ok ? 'success' : 'warning') }}>Request handover</Button>}</label>)}
      <label className="ci-dupe"><input type="radio" name="use" checked={use === ''} onChange={() => setUse('')}/><span>Create a new patient record</span></label>
    </div>}
    {!account && <div className="ci-fields">{FIELDS.map(([k, label, type]) => <Field key={k} label={label} hint={row.scanned_fields?.includes(k) ? 'Read from the patient’s ID on their phone' : null}>
      <input type={type || 'text'} value={fields[k] || ''} disabled={!!use} className={row.scanned_fields?.includes(k) ? 'from-id' : ''} onChange={e => setFields(f => ({ ...f, [k]: e.target.value }))}/>
    </Field>)}
      <p className="au-muted">Emergency contact: {row.self?.emergency_contact?.name} · {row.self?.emergency_contact?.phone}</p>
      {(row.dependents || []).map((d, i) => <p key={i} className="au-muted">Dependent: <b>{d.first_name} {d.last_name}</b> · born {d.date_of_birth}{d.minor ? ` · minor (age ${age(d.date_of_birth)}), guardian ${holder}` : ''} · {d.relationship}{d.relationship_other ? ` (${d.relationship_other})` : ''}</p>)}
      {Object.keys(corrections).length > 0 && !use && <p className="au-muted">You changed: {Object.keys(corrections).join(', ')} (recorded in the audit trail, field names only).</p>}
    </div>}
    {row.join_queue && <p className="au-muted">If the patient already has a booking today at this branch, that booking is checked in (its Dentist’s queue) and the choice below is not used.</p>}
    {row.join_queue && <div className="ci-fields">
      <Field label="Service today" hint="Optional"><select value={serviceId} onChange={e => { setServiceId(e.target.value); setDentistId('') }}><option value="">Not chosen yet</option>{services.map(sv => <option key={sv.id} value={sv.id}>{sv.name}</option>)}</select></Field>
      <Field label="Dentist" hint="Any available: the Dentist for this service with the shortest queue now"><select value={dentistId} disabled={!serviceId} onChange={e => setDentistId(e.target.value)}><option value="">Any available (shortest queue)</option>{dentists.map(d => <option key={d.id} value={d.id}>{dentistName(d.id, state.dentists)}</option>)}</select></Field>
    </div>}
    <div className="ci-id">
      <Field label="ID shown"><select value={idType} onChange={e => { setIdType(e.target.value); setIdOtherTouched(false); if (e.target.value !== 'other') setIdOther('') }}>{Object.entries(idTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      {idType === 'other' && (
        <Field label="Specify ID type" required={idChecked} hint="Required when recording an in-person ID check. Example: Company ID. Enter the type only, not its number." error={idChecked && idOtherTouched && !idOther.trim() ? 'Specify the ID type.' : undefined}>
          <input
            type="text"
            required={idChecked}
            maxLength={100}
            value={idOther}
            onChange={e => setIdOther(e.target.value)}
            onBlur={() => setIdOtherTouched(true)}
          />
        </Field>
      )}
      <label className="au-check"><input type="checkbox" checked={idChecked} onChange={e => setIdChecked(e.target.checked)}/> I checked this ID in person (only the type, your name and the time are saved; never the number or a photo)</label>
    </div>
    </fieldset>
    {busy && <p role="status">{busy === 'confirm' ? 'Confirming registration.' : 'Removing registration.'} Closing this dialog does not cancel the submitted request.</p>}
    {err && <p className="au-error" role="alert">{err}</p>}
    <div className="form-actions">
      <Button variant="ghost" disabled={!!busy} onClick={cancel}>Remove</Button>
      <Button disabled={!!busy || (idChecked && idType === 'other' && !idOther.trim())} onClick={confirm}>{busy === 'confirm' ? 'Confirming…' : row.join_queue ? 'Confirm and check in' : 'Confirm'}</Button>
    </div>
  </Modal>
}

const ID_TYPES = { philid: 'PhilID / ePhilID', drivers_license: 'Driver’s license', umid: 'UMID', passport: 'Passport', postal: 'Postal ID', prc: 'PRC ID', voters: 'Voter’s ID', senior: 'Senior citizen ID', pwd: 'PWD ID', other: 'Other valid ID' }

/** One click at Check-In: the patient's physical ID was checked (first visit). Only the type, who and when are saved. */
/**
 * "Offer online account": after the ID check, staff confirm the patient's email with them and a one-time link is emailed (works
 * once, expires). This is the only way a record registered without an email gets an online account.
 */
function OfferAccount({ patientId, email: stored, toast }) {
  const live = React.useRef(false)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [open, setOpen] = useState(false), [email, setEmail] = useState(stored || ''), [busy, setBusy] = useState(false), [sent, setSent] = useState(null)
  if (sent) return <p className="au-muted" role="status">Online account offered. {sent}</p>
  if (!open) return <Button size="sm" variant="soft" onClick={() => setOpen(true)}>Offer online account</Button>
  const go = async () => {
    setBusy(true)
    const r = await offerOnlineAccount(patientId, { email })
    if (!live.current) return
    setBusy(false)
    if (!r.ok) return toast(firstError(r), 'warning')
    setSent(r.data?.message || '')
    toast(r.data?.message || 'Online account offered.', r.data?.status === 'transport_accepted' ? 'success' : 'warning')
  }
  return <div className="au-actions"><label className="sr-only" htmlFor={`offer-${patientId}`}>Patient’s email (confirm it with them)</label>
    <input id={`offer-${patientId}`} type="email" placeholder="Confirm the patient’s email with them" value={email} onChange={e => setEmail(e.target.value)}/>
    <Button size="sm" disabled={busy || !email} onClick={go}>Email a one-time link</Button></div>
}

export function IdCheck({ patientId, toast = () => {} }) {
  // Each selection owns a new lifetime, including A -> B -> A. Never reuse a
  // previous patient's inputs or let an unmounted request report feedback.
  return patientId ? <PatientIdCheck key={patientId} patientId={patientId} toast={toast}/> : null
}

function PatientIdCheck({ patientId, toast }) {
  const live = React.useRef(false), verifying = React.useRef(false)
  const [record, setRecord] = useState(null), [type, setType] = useState('philid'), [otherText, setOtherText] = useState(''), [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0), [loadError, setLoadError] = useState(null), [failure, setFailure] = useState(null), [otherTouched, setOtherTouched] = useState(false)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => {
    let current = true
    setRecord(null); setLoadError(null); setFailure(null)
    const load = async () => {
      let r
      try { r = await getPatientRecord(patientId) }
      catch { r = {ok: false, message: 'The patient record could not be loaded. Try again.'} }
      if (!current || !live.current) return
      if (r.ok && r.data?.id === patientId) setRecord(r.data)
      else setLoadError(r.ok ? {message: 'The patient record could not be confirmed. Reload it before recording an ID check.'} : r)
    }
    load()
    return () => { current = false }
  }, [patientId, attempt])
  const reload = () => { if (!verifying.current) { setRecord(null); setLoadError(null); setFailure(null); setAttempt(a => a + 1) } }
  const accessError = r => r?.kind === 'unauthenticated' ? 'Your session has ended. Sign in again to check ID status.'
    : r?.kind === 'forbidden' ? 'You do not have permission to view or record this patient’s ID check.'
    : r?.kind === 'validation' ? r.message || 'Check the highlighted fields and try again.'
    : r?.kind === 'server' ? 'The request could not be confirmed. Reload ID status before retrying.' : firstError(r)
  if (loadError) return <div className="ci-idcheck"><p className="au-error" role="alert">{accessError(loadError)}</p><Button variant="soft" onClick={reload}>Reload ID status</Button></div>
  if (!record) return <p className="au-muted" role="status">Loading patient ID status…</p>
  // Identity-only projections deliberately omit verification details. Missing
  // details must not be presented as an unchecked, writable record.
  if (record.profile_access !== 'full') return <p className="au-muted" role="status">ID verification details are unavailable with your current access.</p>
  const minor = record.minor ? <p className="fd-badge is-late">Minor{record.guardians?.length ? `: guardian ${record.guardians.map(g => g.name).join(', ')}` : ': no guardian linked yet'}</p> : null
  if (record.id_check) return <div className="ci-idcheck">{minor}<p className="au-muted" role="status">ID checked: {ID_TYPES[record.id_check.type] || record.id_check.type}{record.id_check.other_details ? ` (${record.id_check.other_details})` : ''}{record.id_check.by ? ` by ${record.id_check.by}` : ''}. {record.id_check.type === 'senior' && <span className="fd-badge is-info">Senior Citizen Priority Eligible</span>}{record.id_check.type === 'pwd' && <span className="fd-badge is-info">PWD Priority Eligible</span>}</p>
    {!record.has_online_account && (record.minor
      ? <p className="au-muted">Under 18: no online account of their own. Their guardian’s account books and pays for them; they can claim their own account at 18.</p>
      : <OfferAccount patientId={patientId} email={record.email} toast={toast}/>)}</div>
  const go = async () => {
    if (!live.current || verifying.current || record.id_check || ['forbidden', 'unauthenticated', 'unconfirmed'].includes(failure?.kind)) return
    if (type === 'other' && !otherText.trim()) { setOtherTouched(true); return }
    const body = { id_type: type, ...(type === 'other' ? { other_details: otherText.trim() } : {}) }
    verifying.current = true; setBusy(true); setFailure(null)
    let r
    try { r = await verifyPatientId(patientId, body) }
    catch { r = {ok: false, message: 'The ID-check result could not be confirmed. Reload ID status before retrying.'} }
    if (!live.current) return
    verifying.current = false
    setBusy(false)
    if (!r.ok) return setFailure(r)
    if (!r.data?.id_verified_at || r.data.id_type !== body.id_type) {
      return setFailure({kind: 'unconfirmed', message: 'The ID-check result could not be confirmed. Reload ID status before retrying.'})
    }
    setRecord(x => ({ ...x, id_check: { type: r.data.id_type, other_details: r.data.other_details, at: r.data.id_verified_at } }))
    toast('ID check recorded (type only).', 'success')
  }
  const blocked = ['forbidden', 'unauthenticated', 'unconfirmed'].includes(failure?.kind)
  const otherError = failure?.errors?.other_details?.[0] || (type === 'other' && otherTouched && !otherText.trim() ? 'Specify the ID type.' : undefined)
  return <div className="ci-idcheck" aria-busy={busy}>{minor}
    <p><b>First visit: check the ID.</b> {record.minor ? 'For a minor, check the guardian’s ID.' : ''}</p>
    <div className="ci-id">
      <Field label="ID shown" error={failure?.errors?.id_type?.[0]}><select disabled={busy || blocked} value={type} onChange={e => { setType(e.target.value); setOtherTouched(false); setFailure(null); if (e.target.value !== 'other') setOtherText('') }}>{Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      {type === 'other' && <Field label="Specify ID type" required hint="Example: Company ID. Enter the type only, not its number." error={otherError}>
        <input type="text" required maxLength={100} disabled={busy || blocked} value={otherText} onChange={e => { setOtherText(e.target.value); setFailure(null) }} onBlur={() => setOtherTouched(true)}/>
      </Field>}
      <div className="au-actions"><Button variant="soft" disabled={busy || blocked || (type === 'other' && !otherText.trim())} onClick={go}>{busy ? 'Recording ID check…' : 'ID checked'}</Button></div>
    </div>
    {busy && <p className="au-muted" role="status">Recording the ID check for this patient…</p>}
    {failure && <><p className="au-error" role="alert">{accessError(failure)}</p><Button variant="soft" onClick={reload}>Reload ID status</Button></>}
    <p className="au-muted">This records the ID check only. Check-in is a separate action.</p>
  </div>
}
