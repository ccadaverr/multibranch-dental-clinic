import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, resolveEncounter } from '../encounter.js'
import React, { useEffect, useState } from 'react'
import { Button, Card, Field, FilterBar, Modal, Notice, PageHeader } from '../components.jsx'
import { createFollowup, followups, patientFollowups, updateFollowup } from '../api-client.js'
import { AppointmentForm } from './Scheduling.jsx'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'
const day = d => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const TONE = { Open: 'is-pending', Contacted: 'is-info', Booked: 'is-ok', Closed: 'is-done' }

/**
 * M20 Patient Follow-Up (clinic server). Tasks come from a completed treatment's follow-up (automatically) or are added by a Dentist
 * or the front desk. "Book follow-up" opens the normal booking form with the patient, branch and service preselected; booking marks
 * the task Booked by itself. Closing without a booking needs a note. The Owner sees counts and dates only.
 */
export function FollowupsServerPage(props) {
  const allowed=useClinicalSession(props.store)
  if(props.role==='dentist'&&!allowed)return <Notice>Clinical session unavailable. Follow-up information is hidden.</Notice>
  const linked=props.context?.returnEncounter?resolveEncounter(props.store.state,props.store.session,props.context.returnEncounter):null
  if(linked&&!linked.ok)return <Notice>{linked.message}<Button onClick={()=>props.setPage('queue')}>My Queue</Button></Notice>
  return <FollowupsBody key={clinicalSessionKey(props.store.session)+(props.context?.patientId||'all')} {...props}/>
}
function FollowupsBody({ store, role, context, setPage }) {
  const toast = store?.toast || (() => {})
  const owner = role === 'owner'
  const branches = (store?.state?.branches || []).filter(b => b.status !== 'Closed')
  const [rows, setRows] = useState(null), [meta, setMeta] = useState({}), [error, setError] = useState(''), [filters, setFilters] = useState({ status: 'active', due: 'all', branch_ref: '' })
  const load = () => (context?.patientId?patientFollowups(context.patientPublicId||context.patientId):followups(filters)).then(r => { if (r.ok) { setRows(r.data); setMeta(r.meta || {}); setError('') } else setError(r.message || 'Follow-ups could not be loaded.') })
  useEffect(() => { load() }, [filters.status, filters.due, filters.branch_ref])
  const c = meta.counts || {}
  return <div className="st-page">
    {context?.returnEncounter&&<Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button>}
    {context?.patientId&&<Notice>Patient follow-up tasks. A recommendation is not a booked appointment; tasks are not linked to a specific treatment in this response.</Notice>}
    <PageHeader kicker={owner ? 'Administration' : 'Patients'} title="Follow-ups"
      text={owner ? 'Follow-ups the dentists asked for: how many are open and overdue. The reasons are visible only to the branch teams.'
        : 'Patients the dentist asked to see again. Call or message them, then book the follow-up; booking marks the task as Booked.'}/>
    {!context?.patientId&&<p className="fu-counts" aria-live="polite"><b>{c.open ?? '…'}</b> open · <b className={c.overdue ? 'is-bad' : ''}>{c.overdue ?? '…'}</b> overdue · <b>{c.due_today ?? '…'}</b> due today</p>}
    {error && <Notice tone="warning" title="Unavailable">{error}</Notice>}
    <Card>
      {!context?.patientId&&<FilterBar className="st-filters" ariaLabel="Follow-up filters" onClear={(filters.status !== 'active' || filters.due !== 'all' || filters.branch_ref) ? () => setFilters({ status: 'active', due: 'all', branch_ref: '' }) : null}>
        <Field label="Status"><select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}><option value="active">Open and contacted</option>{['Open', 'Contacted', 'Booked', 'Closed'].map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Due"><select value={filters.due} onChange={e => setFilters(f => ({ ...f, due: e.target.value }))}><option value="all">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">Within 7 days</option></select></Field>
        <Field label="Branch"><select value={filters.branch_ref} onChange={e => setFilters(f => ({ ...f, branch_ref: e.target.value }))}><option value="">All my branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </FilterBar>}
      {!rows ? <p className="au-muted" role="status">Loading…</p> : !rows.length ? <p className="au-muted">No follow-ups here.</p>
        : <ul className="fd-list">{rows.map(t => <FollowupRow key={t.id} t={t} owner={owner} role={role} store={store} toast={toast} onChanged={load}/>)}</ul>}
    </Card>
  </div>
}

function FollowupRow({ t, owner, role, store, toast, onChanged }) {
  const [closing, setClosing] = useState(false), [note, setNote] = useState(''), [booking, setBooking] = useState(false), [busy, setBusy] = useState('')
  const act = async (action, body = {}) => {
    setBusy(action)
    const r = await updateFollowup(t.id, { action, ...body })
    setBusy('')
    if (!r.ok) return toast(firstError(r), 'warning')
    toast(action === 'contacted' ? 'Marked as contacted.' : 'Follow-up closed.', 'success'); setClosing(false); onChanged()
  }
  return <li className={t.overdue ? 'fu-overdue' : ''}>
    <div><b>{owner ? `Due ${day(t.due_on)}` : `${t.patient.name} · ${t.patient.code}`}</b>
      <span><span className={`fd-badge ${TONE[t.status]}`}>{t.status}</span>{t.overdue ? <span className="fd-badge is-bad">Overdue</span> : ''} · {owner ? '' : `due ${day(t.due_on)} · `}{t.branch.name}{owner ? '' : ` · ${t.assignee}`}</span>
      {!owner && <span>{t.reason}{t.service ? ` · book: ${t.service.name}` : ''}{t.patient.phone ? ` · ${t.patient.phone}` : ''}</span>}
      {t.appointment && <span>Booked: {t.appointment.code} · {t.appointment.when}</span>}
      {t.close_note && <span>Closed: {t.close_note}</span>}
      {closing && <Field label="Why is it closed without a booking?" required><input value={note} maxLength={500} onChange={e => setNote(e.target.value)}/></Field>}
    </div>
    {!owner && <div className="ns-actions">
      {t.can_book && role === 'staff' && <Button size="sm" onClick={() => setBooking(true)}>Book follow-up</Button>}
      {t.can_contact && <Button size="sm" variant="soft" disabled={!!busy} onClick={() => act('contacted')}>Contacted</Button>}
      {t.can_close && !closing && <Button size="sm" variant="ghost" onClick={() => (t.appointment ? act('close') : setClosing(true))}>Close</Button>}
      {closing && <>
        <Button size="sm" disabled={!!busy || note.trim().length < 3} onClick={() => act('close', { note })}>{busy === 'close' ? 'Closing…' : 'Close it'}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setClosing(false); setNote('') }}>Cancel</Button>
      </>}
    </div>}
    {booking && <Modal open wide title={`Book a follow-up for ${t.patient.name}`} onClose={() => setBooking(false)}>
      <AppointmentForm role={role} store={store} prefill={{ patientPublicId: t.patient.id, patientName: `${t.patient.name} • ${t.patient.code}`, branchId: t.branch.id, serviceId: t.service?.id || '', date: t.due_on }}
        submitLabel="Book the follow-up" onSaved={() => { setBooking(false); toast('Booked. The follow-up is marked as Booked.', 'success'); onChanged() }}/>
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
export function FollowupPanel({ patientId, branches = [], toast, store, role = 'staff' }) {
  const [rows, setRows] = useState(null), [adding, setAdding] = useState(false)
  const [reasonCategory, setReasonCategory] = useState(STANDARD_REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [f, setF] = useState({ branch_ref: branches[0]?.id || '', due_on: manilaToday() }), [err, setErr] = useState('')
  const load = () => patientFollowups(patientId).then(r => setRows(r.ok ? r.data : []))
  useEffect(() => { load() }, [patientId])
  const effectiveReason = reasonCategory === 'Other' ? customReason.trim() : reasonCategory

  const add = async e => {
    e.preventDefault(); setErr('')
    if (!effectiveReason) return setErr('Please select or enter a reason for follow-up.')
    const r = await createFollowup({ patient_id: patientId, reason: effectiveReason, ...f, branch_ref: f.branch_ref || branches[0]?.id })
    if (!r.ok) return setErr(firstError(r))
    toast('Follow-up added.', 'success'); setAdding(false); setCustomReason(''); load()
  }
  return <section className="st-panel" aria-labelledby={`fu-${patientId}`}>
    <h3 id={`fu-${patientId}`} className="st-sub">Follow-ups</h3>
    {!rows ? <p className="au-muted" role="status">Loading…</p> : !rows.length ? <p className="au-muted">No follow-ups for this patient.</p>
      : <ul className="fd-list">{rows.map(t => <FollowupRow key={t.id} t={t} role={role} store={store} toast={toast} onChanged={load}/>)}</ul>}
    {adding ? <form className="au-form" onSubmit={add}>
      <Field label="Branch"><select value={f.branch_ref} onChange={e => setF(x => ({ ...x, branch_ref: e.target.value }))}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Follow-up reason" required hint="Seen by the branch team only, never by the patient.">
        <select value={reasonCategory} onChange={e => { setReasonCategory(e.target.value); if (e.target.value !== 'Other') setCustomReason('') }}>
          {STANDARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {reasonCategory === 'Other' && <Field label="Specify reason" required><input value={customReason} maxLength={500} placeholder="Enter specific clinical reason…" onChange={e => setCustomReason(e.target.value)} required/></Field>}
      <Field label="Due" required><input type="date" value={f.due_on} onChange={e => setF(x => ({ ...x, due_on: e.target.value }))} required/></Field>
      {err && <p className="au-error" role="alert">{err}</p>}
      <div className="ns-actions"><Button type="submit" size="sm" disabled={!effectiveReason}>Add follow-up</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
    </form> : <Button size="sm" variant="soft" onClick={() => setAdding(true)}>Add a follow-up</Button>}
  </section>
}
