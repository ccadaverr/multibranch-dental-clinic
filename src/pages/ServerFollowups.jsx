import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, encounterKey, resolveEncounter } from '../encounter.js'
import React, { useEffect, useState } from 'react'
import { Button, Card, Field, FilterBar, Modal, Notice, PageHeader } from '../components.jsx'
import { createFollowup, followups, patientFollowups, updateFollowup } from '../api-client.js'
import { AppointmentForm } from './Scheduling.jsx'

const firstError = r => ['network', 'server'].includes(r.kind) ? 'The follow-up request could not be confirmed. Reload the list before retrying.'
  : (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'
const day = d => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const TONE = { Open: 'is-pending', Contacted: 'is-info', Booked: 'is-ok', Closed: 'is-done' }

// One selection lifetime per patient/session/filter combination. A -> B -> A
// gets a new scope object; matching the same ID must not revive an old request.
function useFollowupList(key, request, patientId = null, owner = false) {
  const live = React.useRef(false), sequence = React.useRef(0), selection = React.useRef(null), fetchRows = React.useRef(request)
  fetchRows.current = request
  if (selection.current?.key !== key) selection.current = {key}
  const scope = selection.current
  const isCurrent = () => live.current && selection.current === scope
  const [result, setResult] = useState({scope: null, rows: null, meta: {}, error: ''})
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; sequence.current++ } }, [])
  const load = React.useCallback(async () => {
    if (!live.current || selection.current !== scope) return
    const serial = ++sequence.current, fetch = fetchRows.current
    setResult({scope, rows: null, meta: {}, error: ''})
    let r
    try { r = await fetch() }
    catch { r = {ok: false, message: 'Follow-ups could not be confirmed. Reload the list before retrying a command.'} }
    if (!live.current || selection.current !== scope || sequence.current !== serial) return
    const valid = r.ok && Array.isArray(r.data) && r.data.every(t => t?.id && t.branch && (owner || (t.patient?.id && (!patientId || t.patient.id === patientId))))
    setResult(valid ? {scope, rows: r.data, meta: r.meta || {}, error: ''}
      : {scope, rows: null, meta: {}, error: r.ok ? 'The follow-up list did not match this patient or request. Reload it before continuing.'
        : r.kind === 'unauthenticated' ? 'Your session has ended. Sign in again to view follow-ups.'
        : r.kind === 'forbidden' ? 'You do not have permission to view these follow-ups.' : firstError(r)})
  }, [scope, patientId, owner])
  useEffect(() => { load() }, [load])
  return {...(result.scope === scope ? result : {rows: null, meta: {}, error: ''}), load, isCurrent}
}

/**
 * M20 Patient Follow-Up (clinic server). Tasks come from a completed treatment's follow-up (automatically) or are added by a Dentist
 * or the front desk. "Book follow-up" opens the normal booking form with the patient, branch and service preselected; the server
 * chooses the eligible task to link. Reload its authoritative status after booking. Closing without a booking needs a note.
 * The Owner sees counts and dates only.
 */
export function FollowupsServerPage(props) {
  const allowed=useClinicalSession(props.store)
  if(props.role==='dentist'&&!allowed)return <Notice>Clinical session unavailable. Follow-up information is hidden.</Notice>
  const linked=props.context?.returnEncounter?resolveEncounter(props.store.state,props.store.session,props.context.returnEncounter):null
  if(linked&&!linked.ok)return <Notice>{linked.message}<Button onClick={()=>props.setPage('queue')}>My Queue</Button></Notice>
  const patientId = props.context?.patientPublicId || props.context?.patientId || null
  if (!['staff', 'dentist', 'owner'].includes(props.role)) return <Notice>Follow-up information is unavailable for this role.</Notice>
  return <FollowupsBody key={JSON.stringify([clinicalSessionKey(props.store.session), props.role, patientId, props.context?.returnEncounter ? encounterKey(props.context.returnEncounter) : null])} {...props}/>
}
function FollowupsBody({ store, role, context, setPage }) {
  const toast = store?.toast || (() => {})
  const owner = role === 'owner'
  const branches = (store?.state?.branches || []).filter(b => b.status !== 'Closed')
  const [filters, setFilters] = useState({ status: 'active', due: 'all', branch_ref: '' })
  const patientId = context?.patientPublicId || context?.patientId || null
  const {rows, meta, error, load, isCurrent} = useFollowupList(JSON.stringify([patientId, filters]), () => patientId ? patientFollowups(patientId) : followups({...filters}), patientId, owner)
  const c = meta.counts || {}
  return <div className="st-page">
    {context?.returnEncounter&&<Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button>}
    {patientId&&<Notice>Patient follow-up tasks. A recommendation is not a booked appointment; tasks are not linked to a specific treatment in this response.</Notice>}
    <PageHeader kicker={owner ? 'Administration' : 'Patients'} title="Follow-ups"
      text={owner ? 'Follow-ups the dentists asked for: how many are open and overdue. The reasons are visible only to the branch teams.'
        : 'Patients the dentist asked to see again. Call or message them, then book a follow-up appointment and check the task’s status.'}/>
    {!patientId&&<p className="fu-counts" aria-live="polite"><b>{c.open ?? '…'}</b> open · <b className={c.overdue ? 'is-bad' : ''}>{c.overdue ?? '…'}</b> overdue · <b>{c.due_today ?? '…'}</b> due today</p>}
    {error && <Notice tone="error" title="Follow-ups unavailable">{error} <Button variant="soft" onClick={load}>Reload follow-ups</Button></Notice>}
    <Card>
      {!patientId&&<FilterBar className="st-filters" ariaLabel="Follow-up filters" onClear={(filters.status !== 'active' || filters.due !== 'all' || filters.branch_ref) ? () => setFilters({ status: 'active', due: 'all', branch_ref: '' }) : null}>
        <Field label="Status"><select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}><option value="active">Open and contacted</option>{['Open', 'Contacted', 'Booked', 'Closed'].map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Due"><select value={filters.due} onChange={e => setFilters(f => ({ ...f, due: e.target.value }))}><option value="all">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">Within 7 days</option></select></Field>
        <Field label="Branch"><select value={filters.branch_ref} onChange={e => setFilters(f => ({ ...f, branch_ref: e.target.value }))}><option value="">All my branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </FilterBar>}
      {!rows ? !error && <p className="au-muted" role="status">Loading follow-ups…</p> : !rows.length ? <p className="au-muted" role="status">No follow-ups here.</p>
        : <ul className="fd-list">{rows.map(t => <FollowupRow key={JSON.stringify([t.id, t.patient?.id, t.revision])} t={t} owner={owner} role={role} store={store} toast={toast} onChanged={load} isCurrent={isCurrent}/>)}</ul>}
    </Card>
  </div>
}

function FollowupRow({ t, owner, role, store, toast, onChanged, isCurrent }) {
  const live = React.useRef(false), pending = React.useRef(false), bookingToken = React.useRef(null)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; bookingToken.current = null } }, [])
  const ownsRow = () => live.current && isCurrent()
  const canWork = !owner && ['staff', 'dentist'].includes(role)
  const [closing, setClosing] = useState(false), [note, setNote] = useState(''), [booking, setBooking] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const closeBooking = () => { bookingToken.current = null; setBooking(null) }
  const ownsBooking = () => ownsRow() && !!booking && bookingToken.current === booking
  const bookingStore = {...store, toast: (...args) => { if (ownsBooking()) toast?.(...args) }}
  const act = async (action, body = {}) => {
    if (!ownsRow() || pending.current || !canWork || (action === 'contacted' ? !t.can_contact : !t.can_close)) return
    const submitted = {id: t.id, patientId: t.patient.id, body: {action, ...body}}
    pending.current = true; setBusy(action); setError('')
    let r
    try { r = await updateFollowup(submitted.id, submitted.body) }
    catch { r = {ok: false, message: 'The follow-up result could not be confirmed. Reload the list before retrying.'} }
    if (!ownsRow()) return
    pending.current = false
    setBusy('')
    if (!r.ok) return setError(firstError(r))
    if (r.data?.id !== submitted.id || r.data?.patient?.id !== submitted.patientId || r.data.status !== (action === 'contacted' ? 'Contacted' : 'Closed')) return setError('The follow-up result could not be confirmed. Reload the list before retrying.')
    toast?.(action === 'contacted' ? 'Marked as contacted.' : 'Follow-up closed.', 'success'); setClosing(false); onChanged()
  }
  return <li className={t.overdue ? 'fu-overdue' : ''}>
    <div><b>{owner ? `Due ${day(t.due_on)}` : `${t.patient.name} · ${t.patient.code}`}</b>
      <span><span className={`fd-badge ${TONE[t.status]}`}>{t.status}</span>{t.overdue ? <span className="fd-badge is-bad">Overdue</span> : ''} · {owner ? '' : `due ${day(t.due_on)} · `}{t.branch.name}{owner ? '' : ` · ${t.assignee}`}</span>
      {!owner && <span>{t.reason}{t.service ? ` · book: ${t.service.name}` : ''}{t.patient.phone ? ` · ${t.patient.phone}` : ''}</span>}
      {!owner && t.appointment && <span>Booked: {t.appointment.code} · {t.appointment.when}</span>}
      {!owner && t.close_note && <span>Closed: {t.close_note}</span>}
      {closing && <Field label="Why is it closed without a booking?" required><input value={note} disabled={!!busy} maxLength={500} onChange={e => setNote(e.target.value)}/></Field>}
      {busy && <span role="status">{busy === 'close' ? 'Closing follow-up…' : 'Recording contact…'}</span>}
      {error && <div role="alert"><p className="au-error">{error}</p><Button variant="soft" onClick={onChanged}>Reload follow-ups</Button></div>}
    </div>
    {canWork && <div className="ns-actions">
      {t.can_book && role === 'staff' && <Button size="sm" disabled={!!busy} onClick={() => { if (!pending.current && ownsRow()) { const token = {}; bookingToken.current = token; setBooking(token) } }}>Book follow-up</Button>}
      {t.can_contact && <Button size="sm" variant="soft" disabled={!!busy} onClick={() => act('contacted')}>Contacted</Button>}
      {t.can_close && !closing && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => (t.appointment ? act('close') : setClosing(true))}>Close</Button>}
      {closing && <>
        <Button size="sm" disabled={!!busy || note.trim().length < 3} onClick={() => act('close', { note })}>{busy === 'close' ? 'Closing…' : 'Close it'}</Button>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setClosing(false); setNote(''); setError('') }}>Cancel</Button>
      </>}
    </div>}
    {booking && <Modal open wide title={`Book a follow-up for ${t.patient.name}`} onClose={closeBooking}>
      <AppointmentForm role={role} store={bookingStore} prefill={{ patientPublicId: t.patient.id, patientName: `${t.patient.name} • ${t.patient.code}`, branchId: t.branch.id, serviceId: t.service?.id || '', date: t.due_on }}
        submitLabel="Book the follow-up" onSaved={() => { if (!ownsBooking()) return; closeBooking(); toast?.('Appointment booked. Reloading follow-up status.', 'success'); onChanged() }}/>
    </Modal>}
  </li>
}

const STANDARD_REASONS = [
  'Post-Op Check',
  'Suture Removal',
  'Crown / Bridge Fitting',
  'Restoration Polish',
  'Ortho Adjustment',
  'Routine Cleaning / Recall',
  'Other'
]

/** The follow-up tasks on a patient record (front desk), with "Add a follow-up". */
export function FollowupPanel(props) {
  const role = props.role || 'staff'
  if (!props.patientId) return <Notice>Select a patient to view follow-ups.</Notice>
  if (!['staff', 'dentist', 'owner'].includes(role)) return <Notice>Patient follow-up information is unavailable for this role.</Notice>
  return <PatientFollowupPanel key={JSON.stringify([clinicalSessionKey(props.store?.session), role, props.patientId])} {...props} role={role}/>
}

function PatientFollowupPanel({ patientId, branches = [], toast, store, role }) {
  const owner = role === 'owner', canCreate = ['staff', 'dentist'].includes(role)
  const {rows, error, load, isCurrent} = useFollowupList(patientId, () => patientFollowups(patientId), patientId, owner)
  const live = React.useRef(false), pending = React.useRef(false)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [otherTouched, setOtherTouched] = useState(false)
  const [reasonCategory, setReasonCategory] = useState(STANDARD_REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [f, setF] = useState({ branch_ref: branches[0]?.id || '', due_on: manilaToday() }), [err, setErr] = useState('')
  const effectiveReason = reasonCategory === 'Other' ? customReason.trim() : reasonCategory
  const branchRef = f.branch_ref || branches[0]?.id || ''

  const add = async e => {
    e.preventDefault()
    if (!live.current || !isCurrent() || pending.current || !canCreate) return
    setErr('')
    if (!effectiveReason) { setOtherTouched(true); return setErr('Please select or enter a reason for follow-up.') }
    if (!branchRef || !f.due_on) return setErr('Choose a branch and due date.')
    const body = {patient_id: patientId, reason: effectiveReason, ...f, branch_ref: branchRef}
    pending.current = true; setBusy(true)
    let r
    try { r = await createFollowup(body) }
    catch { r = {ok: false, message: 'The follow-up result could not be confirmed. Reload the list before retrying.'} }
    if (!live.current || !isCurrent()) return
    pending.current = false; setBusy(false)
    if (!r.ok) return setErr(firstError(r))
    if (!r.data?.id || r.data?.patient?.id !== body.patient_id || r.data?.branch?.id !== body.branch_ref || r.data.status !== 'Open') return setErr('The follow-up result could not be confirmed. Reload the list before retrying.')
    toast?.('Follow-up added.', 'success'); setAdding(false); setCustomReason(''); load()
  }
  return <section className="st-panel" aria-labelledby={`fu-${patientId}`}>
    <h3 id={`fu-${patientId}`} className="st-sub">Follow-ups</h3>
    {error && <Notice tone="error" title="Follow-ups unavailable">{error} <Button variant="soft" onClick={load}>Reload follow-ups</Button></Notice>}
    {!rows ? !error && <p className="au-muted" role="status">Loading follow-ups…</p> : !rows.length ? <p className="au-muted" role="status">No follow-ups for this patient.</p>
      : <ul className="fd-list">{rows.map(t => <FollowupRow key={JSON.stringify([t.id, t.patient?.id, t.revision])} t={t} owner={owner} role={role} store={store} toast={toast} onChanged={load} isCurrent={isCurrent}/>)}</ul>}
    {canCreate && (adding ? <form className="au-form" aria-busy={busy} onSubmit={add}>
      <Field label="Branch" required><select required disabled={busy} value={branchRef} onChange={e => setF(x => ({ ...x, branch_ref: e.target.value }))}>{!branches.length && <option value="">No available branch</option>}{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Follow-up reason" required hint="Seen by the branch team only, never by the patient.">
        <select disabled={busy} value={reasonCategory} onChange={e => { setReasonCategory(e.target.value); setOtherTouched(false); if (e.target.value !== 'Other') setCustomReason('') }}>
          {STANDARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {reasonCategory === 'Other' && <Field label="Specify reason" required error={otherTouched && !effectiveReason ? 'Specify the follow-up reason.' : undefined}><input disabled={busy} value={customReason} maxLength={500} placeholder="Enter specific clinical reason…" onChange={e => setCustomReason(e.target.value)} onBlur={() => setOtherTouched(true)} required/></Field>}
      <Field label="Due" required><input disabled={busy} type="date" value={f.due_on} onChange={e => setF(x => ({ ...x, due_on: e.target.value }))} required/></Field>
      {err && <p className="au-error" role="alert">{err}</p>}
      {busy && <p className="au-muted" role="status">Adding follow-up for this patient…</p>}
      {err && <Button variant="soft" disabled={busy} onClick={load}>Reload follow-ups</Button>}
      <div className="ns-actions"><Button type="submit" size="sm" disabled={busy || !effectiveReason || !branchRef || !f.due_on}>{busy ? 'Adding follow-up…' : 'Add follow-up'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button></div>
    </form> : <Button size="sm" variant="soft" disabled={!branches.length} onClick={() => setAdding(true)}>Add a follow-up</Button>)}
  </section>
}
