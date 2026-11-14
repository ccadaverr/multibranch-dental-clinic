import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, encounterKey, resolveEncounter } from '../encounter.js'
import React, { useEffect, useState } from 'react'
import { Button, Card, Field, FilterBar, Modal, Notice, PageHeader, RefreshButton } from '../components.jsx'
import { createFollowup, followups, patientFollowups, updateFollowup } from '../api-client.js'
import { AppointmentForm } from './Scheduling.jsx'
import { canSchedule, schedulingActorKey } from '../appointment-ui.js'

const firstError = r => !r || ['network', 'server'].includes(r.kind) ? 'The follow-up request could not be confirmed. Reload the list before retrying.'
  : (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'
const day = d => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const TONE = { Open: 'is-pending', Contacted: 'is-info', Booked: 'is-ok', Closed: 'is-done' }
const publicTaskId = value => typeof value === 'string' && value.length === 26 && /^[0-7][0-9a-hjkmnp-tv-z]{25}$/i.test(value)

// Shape/context checks only. Clinical eligibility and linkage remain server-authoritative.
function clinicalBookingSelection(task, role, store) {
  if (role !== 'staff' || store?.session?.role !== 'staff' || !canSchedule(store, task?.branch?.id) ||
      !publicTaskId(task?.id) || !publicTaskId(task?.patient?.id) ||
      !Number.isInteger(task?.revision) || task.revision < 1 || task.revision > 2147483647 ||
      !['Open', 'Contacted'].includes(task.status) || task.can_book !== true || task.appointment != null ||
      typeof task.branch?.id !== 'string' || !task.branch.id ||
      !store.state.branches?.some(b => b.id === task.branch.id && b.status === 'Open') ||
      (task.service != null && (typeof task.service.id !== 'string' || !task.service.id))) return null
  return Object.freeze({taskId: task.id, expectedRevision: task.revision, patientPublicId: task.patient.id, branchId: task.branch.id})
}

// A capped list can establish an exact current relationship, never the earlier command's receipt or absence.
function currentFollowupReview(result, selected) {
  if (result?.ok !== true || !Array.isArray(result.data) || !publicTaskId(selected?.taskId) ||
      !publicTaskId(selected?.patientPublicId) || !Number.isInteger(selected?.expectedRevision) || selected.expectedRevision < 1 ||
      selected.expectedRevision > 2147483647 || !Object.hasOwn(TONE, selected.observedStatus)) return null
  const rows = result.data.filter(t => t?.id === selected.taskId)
  if (rows.length !== 1) return null
  const task = rows[0]
  if (task.patient?.id !== selected.patientPublicId || task.branch?.id !== selected.branchId ||
      !Number.isInteger(task.revision) || task.revision < selected.expectedRevision || task.revision > 2147483647 ||
      // R2 contact, booking, closure and reopening all advance revision.
      (task.revision === selected.expectedRevision && task.status !== selected.observedStatus) ||
      !Object.hasOwn(TONE, task.status) ||
      (task.status === 'Booked' && !publicTaskId(task.appointment?.id)) ||
      (['Open', 'Contacted'].includes(task.status) && task.appointment != null)) return null
  return {status: task.status, revision: task.revision,
    appointment: publicTaskId(task.appointment?.id) ? {id: task.appointment.id,
      code: typeof task.appointment.code === 'string' ? task.appointment.code : '',
      when: typeof task.appointment.when === 'string' ? task.appointment.when : ''} : null}
}

const followupDescription = owner => owner ? 'Follow-ups the dentists asked for: how many are open and overdue. The reasons are visible only to the branch teams.'
        : 'Patients the dentist asked to see again. Call or message them, then book a follow-up appointment and check the task’s status.'

// Runtime-only, bounded to the existing provider authentication lifetime. This
// is a UI continuity guard, not a server-issued session or operation receipt.
const followupLifetimes = new WeakMap()
let followupLifetimeId = 0
const followupOperations = () => ({tasks: new Map(), creates: new Map(), verified: new Map(), settlement: 0})
function followupLifetime(store) {
  const read = store?.getAuthGeneration, generation = read?.()
  if (!Number.isSafeInteger(generation)) return {id: null, generation: null, isCurrent: () => false, pendingTasks: followupOperations()}
  let lifetime = followupLifetimes.get(read)
  if (!lifetime || lifetime.generation !== generation) {
    lifetime = {id: ++followupLifetimeId, generation, isCurrent: () => read() === generation, pendingTasks: followupOperations()}
    followupLifetimes.set(read, lifetime)
  }
  return lifetime
}
const followupTaskMatches = (task, submitted) => task?.id === submitted.id && task.patient?.id === submitted.patientId && task.branch?.id === submitted.branchId
const followupTaskConfirmed = (r, submitted) => r?.ok === true && followupTaskMatches(r.data, submitted) && r.data.status === (submitted.action === 'contacted' ? 'Contacted' : 'Closed') && Number.isSafeInteger(r.data.revision) && r.data.revision > submitted.revision
const followupUncertain = r => !r || r.ok !== false || !r.kind || ['network', 'server'].includes(r.kind)
function followupSnapshotCurrent(pendingTasks, task) {
  const operation = pendingTasks.tasks.get(task.id), known = pendingTasks.verified.get(task.id)
  if (operation && !followupTaskMatches(task, operation.submitted)) return false
  return !known || task.patient?.id === known.patientId && task.branch.id === known.branchId &&
    (task.revision > known.revision || task.revision === known.revision && task.status === known.status)
}
function rememberFollowup(pendingTasks, task) {
  const known = pendingTasks.verified.get(task.id)
  if (!known || task.revision > known.revision) pendingTasks.verified.set(task.id,
    {patientId: task.patient?.id, branchId: task.branch.id, revision: task.revision, status: task.status})
}
function settleFollowup(pendingTasks, operation, result) {
  if (pendingTasks.tasks.get(operation.submitted.id)?.token !== operation.token) return
  operation.phase = followupTaskConfirmed(result, operation.submitted) ? 'confirmed' : followupUncertain(result) ? 'recovery' : 'refused'
  // Invalidate every read started before this write's result became known.
  pendingTasks.settlement++
  if (operation.phase === 'confirmed') rememberFollowup(pendingTasks, result.data)
  if (operation.phase === 'refused') pendingTasks.tasks.delete(operation.submitted.id)
}
function reconcileFollowups(pendingTasks, rows) {
  for (const [id, operation] of pendingTasks.tasks) {
    const submitted = operation.submitted, task = rows.find(t => followupTaskMatches(t, submitted))
    // An unchanged Open snapshot (or an omitted/filtered-out task) cannot prove
    // a timed-out write was not applied. Only positive progress reconciles it.
    const progressed = task && Number.isSafeInteger(task.revision) && task.revision > submitted.revision &&
      (submitted.action === 'contacted' ? ['Contacted', 'Booked', 'Closed'].includes(task.status) : task.status === 'Closed')
    if (operation.phase !== 'pending' && progressed) pendingTasks.tasks.delete(id)
  }
  for (const [patientId, operation] of pendingTasks.creates) {
    // A known create receipt can be reconciled by its exact returned task ID.
    // An uncertain create has no operation receipt: an empty list or a similar
    // pre-existing task cannot establish whether that particular write applied.
    if (operation.phase === 'confirmed' && rows.some(t => t.id === operation.taskId && t.patient?.id === patientId && t.branch?.id === operation.body.branch_ref)) pendingTasks.creates.delete(patientId)
  }
}

// One selection lifetime per patient/session/filter combination. A -> B -> A
// gets a new scope object; matching the same ID must not revive an old request.
function useFollowupList(key, request, patientId = null, owner = false, lifetime = null) {
  const live = React.useRef(false), sequence = React.useRef(0), selection = React.useRef(null), fetchRows = React.useRef(request)
  fetchRows.current = request
  if (selection.current?.key !== key || selection.current?.lifetime !== lifetime) selection.current = {key, lifetime}
  const scope = selection.current
  const localOperations = React.useRef(followupOperations())
  const pendingTasks = lifetime?.pendingTasks || localOperations.current
  const isCurrent = () => live.current && selection.current === scope && (!lifetime || lifetime.isCurrent())
  const [result, setResult] = useState({scope: null, rows: null, meta: {}, error: ''})
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; sequence.current++ } }, [])
  const load = React.useCallback(async () => {
    if (!isCurrent()) return false
    const serial = ++sequence.current, fetch = fetchRows.current, settlement = pendingTasks.settlement
    setResult({scope, rows: null, meta: {}, error: ''})
    let r
    try { r = await fetch() }
    catch { r = {ok: false, message: 'Follow-ups could not be confirmed. Reload the list before retrying a command.'} }
    if (!isCurrent() || sequence.current !== serial) return false
    if (pendingTasks.settlement !== settlement) {
      setResult({scope, rows: null, meta: {}, error: 'A follow-up update settled after this reload began. Reload again to check its current status.'})
      return false
    }
    const shapeValid = r?.ok === true && Array.isArray(r.data) && r.data.every(t => typeof t?.id === 'string' && t.id.trim() && typeof t.branch?.id === 'string' && t.branch.id.trim() && Number.isSafeInteger(t.revision) && t.revision > 0 && Object.hasOwn(TONE, t.status) && (owner || (typeof t.patient?.id === 'string' && t.patient.id.trim() && (!patientId || t.patient.id === patientId))))
    const valid = shapeValid && r.data.every(task => followupSnapshotCurrent(pendingTasks, task))
    if (valid) {
      for (const task of r.data) rememberFollowup(pendingTasks, task)
      if (!owner) reconcileFollowups(pendingTasks, r.data)
    }
    setResult(valid ? {scope, rows: r.data, meta: r.meta || {}, error: ''}
      : {scope, rows: null, meta: {}, error: r?.ok ? 'The follow-up list did not match this patient, request or verified task version. Reload it before continuing.'
        : r?.kind === 'unauthenticated' ? 'Your session has ended. Sign in again to view follow-ups.'
        : r?.kind === 'forbidden' ? 'You do not have permission to view these follow-ups.' : firstError(r)})
    return !!valid
  }, [scope, patientId, owner, pendingTasks])
  useEffect(() => { load() }, [load])
  return {...(result.scope === scope ? result : {rows: null, meta: {}, error: ''}), load, isCurrent, pendingTasks}
}

/**
 * M20 Patient Follow-Up (clinic server). Tasks come from a completed treatment's follow-up (automatically) or are added by a Dentist
 * or the front desk. "Book follow-up" captures an exact server task for the shared selected-booking form.
 * Activation stays closed until running-backend compatibility can be established. No ordinary matcher fallback.
 * The Owner sees counts and dates only.
 */
function FollowupSessionUnavailable({role}) {
  return <div className="st-page"><PageHeader kicker={role === 'owner' ? 'Administration' : 'Patients'} title="Follow-ups" text={followupDescription(role === 'owner')}/><Notice title="Session unavailable">Your follow-up session is unavailable. Sign in again before continuing.</Notice></div>
}
export function FollowupsServerPage(props) {
  const allowed=useClinicalSession(props.store)
  if(props.role==='dentist'&&!allowed)return <Notice>Clinical session unavailable. Follow-up information is hidden.</Notice>
  const linked=props.context?.returnEncounter?resolveEncounter(props.store.state,props.store.session,props.context.returnEncounter):null
  if(linked&&!linked.ok)return <Notice>{linked.message}<Button onClick={()=>props.setPage('queue')}>My Queue</Button></Notice>
  const patientId = props.context?.patientPublicId || props.context?.patientId || null
  if (!['staff', 'dentist', 'owner'].includes(props.role)) return <Notice>Follow-up information is unavailable for this role.</Notice>
  const lifetime = followupLifetime(props.store)
  if (!lifetime.isCurrent()) return <FollowupSessionUnavailable role={props.role}/>
  return <FollowupsBody {...props} lifetime={lifetime} key={JSON.stringify([lifetime.id, clinicalSessionKey(props.store.session), props.role, patientId, props.context?.returnEncounter ? encounterKey(props.context.returnEncounter) : null])}/>
}
function FollowupsBody({ store, role, context, setPage, lifetime }) {
  const toast = store?.toast || (() => {})
  const owner = role === 'owner'
  const branches = (store?.state?.branches || []).filter(b => b.status !== 'Closed')
  const [filters, setFilters] = useState({ status: 'active', due: 'all', branch_ref: '' })
  const patientId = context?.patientPublicId || context?.patientId || null
  const {rows, meta, error, load, isCurrent, pendingTasks} = useFollowupList(JSON.stringify([patientId, filters]), () => patientId ? patientFollowups(patientId) : followups({...filters}), patientId, owner, lifetime)
  const recoveryRoot = React.useRef(null), recoveryFocus = React.useRef(false)
  const reload = () => { recoveryFocus.current = true; return load() }
  React.useLayoutEffect(() => {
    if (!recoveryFocus.current || !rows && !error) return
    recoveryFocus.current = false
    if (typeof document !== 'undefined' && document.activeElement === document.body) {
      const target = recoveryRoot.current?.querySelector('select:not(:disabled),button:not(:disabled)') || recoveryRoot.current
      target?.focus()
    }
  }, [rows, error])
  const c = meta.counts || {}
  return <div className="st-page" ref={recoveryRoot} tabIndex={-1}>
    {context?.returnEncounter&&<Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button>}
    {patientId&&<Notice>Patient follow-up tasks. A recommendation is not a booked appointment; tasks are not linked to a specific treatment in this response.</Notice>}
    <PageHeader kicker={owner ? 'Administration' : 'Patients'} title="Follow-ups"
      text={followupDescription(owner)}/>
    {role === 'staff' && <BookingRecoveryNotice/>}
    {!patientId&&<p className="fu-counts" aria-live="polite"><b>{c.open ?? '…'}</b> open · <b className={c.overdue ? 'is-bad' : ''}>{c.overdue ?? '…'}</b> overdue · <b>{c.due_today ?? '…'}</b> due today</p>}
    {error && <Notice tone="error" title="Follow-ups unavailable">{error} <RefreshButton title="Reload follow-ups" ariaLabel="Reload follow-ups" onClick={reload}/></Notice>}
    <Card>
      {!patientId&&<FilterBar className="st-filters" ariaLabel="Follow-up filters" onClear={(filters.status !== 'active' || filters.due !== 'all' || filters.branch_ref) ? () => setFilters({ status: 'active', due: 'all', branch_ref: '' }) : null}>
        <Field label="Status"><select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}><option value="active">Open and contacted</option>{['Open', 'Contacted', 'Booked', 'Closed'].map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Due"><select value={filters.due} onChange={e => setFilters(f => ({ ...f, due: e.target.value }))}><option value="all">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">Within 7 days</option></select></Field>
        <Field label="Branch"><select value={filters.branch_ref} onChange={e => setFilters(f => ({ ...f, branch_ref: e.target.value }))}><option value="">All my branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </FilterBar>}
      {!rows ? !error && <p className="au-muted" role="status">Loading follow-ups…</p> : !rows.length ? <p className="au-muted" role="status">No follow-ups here.</p>
        : <ul className="fd-list">{rows.map(t => <FollowupRow key={JSON.stringify([t.id, t.patient?.id, t.branch?.id, t.revision, t.service?.id, t.due_on, schedulingActorKey(store)])} t={t} pendingTasks={pendingTasks} owner={owner} role={role} store={store} toast={toast} onChanged={load} onReload={reload} isCurrent={isCurrent}/>)}</ul>}
    </Card>
  </div>
}

function FollowupRow({ t, pendingTasks, owner, role, store, toast, onChanged, onReload, isCurrent }) {
  const live = React.useRef(false), pending = React.useRef(false), bookingToken = React.useRef(null)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; bookingToken.current = null } }, [])
  const auth = React.useRef({read: store?.getAuthGeneration, generation: store?.getAuthGeneration?.()})
  const latest = React.useRef({store, task:t}); latest.current = {store, task:t}
  const actor = React.useRef(store?.session ? schedulingActorKey(store) : null)
  const rowKey = task => JSON.stringify([task.id,task.patient?.id,task.branch?.id,task.revision,task.service?.id])
  const rowContext = React.useRef(rowKey(t))
  const ownsRow = () => live.current && isCurrent() && Number.isSafeInteger(auth.current.generation) && auth.current.read?.() === auth.current.generation && latest.current.store?.getAuthGeneration === auth.current.read && (actor.current === null || schedulingActorKey(latest.current.store) === actor.current) && rowKey(latest.current.task) === rowContext.current
  const taskRequest = pendingTasks?.tasks.get(t.id)
  const staleRow = !followupSnapshotCurrent(pendingTasks, t)
  const observedPendingTask = taskRequest?.phase === 'pending'
  useEffect(() => {
    // A list refresh can remount this row before its original command settles.
    // Capture pending at render: settlement can precede passive effect execution.
    // Reconcile through a read; never issue another command or adopt its toast.
    if (!taskRequest || taskRequest.owner === pending || !observedPendingTask) return
    let current = true
    taskRequest.promise.then(() => { if (current && ownsRow()) onChanged() })
    return () => { current = false }
  }, [taskRequest])
  const canWork = !owner && ['staff', 'dentist'].includes(role)
  const [needsReload, setNeedsReload] = useState(false)
  const [review, setReview] = useState(null)
  const reviewPending = React.useRef(false), reviewFeedback = React.useRef(null)
  useEffect(() => { if (review) reviewFeedback.current?.focus() }, [review])
  const [closing, setClosing] = useState(false), [note, setNote] = useState(''), [booking, setBooking] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const closeBooking = () => { bookingToken.current = null; setBooking(null) }
  const ownsBooking = () => ownsRow() && !!booking && bookingToken.current === booking
  const ownsSelectedBooking = () => ownsBooking() && !!booking.selection &&
    booking.selection.taskId === latest.current.task.id && booking.selection.expectedRevision === latest.current.task.revision &&
    booking.selection.patientPublicId === latest.current.task.patient?.id && booking.selection.branchId === latest.current.task.branch?.id &&
    booking.prefill.serviceId === (latest.current.task.service?.id || '')
  const bookingStore = {...store, toast: (...args) => { if (ownsSelectedBooking()) toast?.(...args) }}
  const selection = clinicalBookingSelection(t, role, store)
  const reviewCurrent = async () => {
    if (!ownsRow() || reviewPending.current || busy || role !== 'staff' || !canSchedule(store, t.branch?.id) || !publicTaskId(t.id) || !publicTaskId(t.patient?.id)) return
    const observed = () => {
      const known = pendingTasks.verified.get(t.id)
      return known?.patientId === t.patient.id && known.branchId === t.branch.id && known.revision >= t.revision ? known : t
    }
    const snapshot = observed()
    const selected = Object.freeze({taskId:t.id, expectedRevision:snapshot.revision, observedStatus:snapshot.status, patientPublicId:t.patient.id, branchId:t.branch.id})
    reviewPending.current = true; setBusy('review'); setReview(null)
    let result
    try { result = await patientFollowups(selected.patientPublicId) } catch { result = null }
    reviewPending.current = false
    if (!ownsRow()) return
    // A newer accepted snapshot may have arrived while this read was pending.
    const latestObserved = observed()
    const current = currentFollowupReview(result, latestObserved.revision > selected.expectedRevision
      ? {...selected, expectedRevision:latestObserved.revision, observedStatus:latestObserved.status} : selected)
    // Reuse list continuity only: do not settle an earlier command or rebase a booking.
    if (current) rememberFollowup(pendingTasks, {id:selected.taskId, patient:{id:selected.patientPublicId}, branch:{id:selected.branchId}, revision:current.revision, status:current.status})
    setBusy(''); setReview(current || {unavailable:true})
  }
  const act = async (action, body = {}) => {
    if (!ownsRow() || pending.current || pendingTasks?.tasks.has(t.id) || !canWork || (action === 'contacted' ? !t.can_contact : !t.can_close)) return
    if (!followupSnapshotCurrent(pendingTasks, t)) return setError('This follow-up changed. Reload the list before continuing.')
    const submitted = {id: t.id, patientId: t.patient.id, branchId: t.branch.id, action, revision: t.revision, body: {action, ...body}}
    pending.current = true; setBusy(action); setError('')
    const request = {owner: pending, submitted, token: {}, phase: 'pending'}
    pendingTasks.tasks.set(submitted.id, request)
    request.promise = (async () => {
      let result
      try { result = await updateFollowup(submitted.id, submitted.body) }
      catch { result = {ok: false, kind: 'network', message: 'The follow-up result could not be confirmed. Reload the list before retrying.'} }
      settleFollowup(pendingTasks, request, result)
      return result
    })()
    const r = await request.promise
    if (!ownsRow()) return
    setBusy('')
    const confirmed = followupTaskConfirmed(r, submitted)
    if (!confirmed) {
      // An uncertain write may already have committed. Keep the synchronous
      // latch closed until an authoritative reload replaces this row.
      const uncertain = followupUncertain(r)
      pending.current = uncertain; setNeedsReload(uncertain)
      return setError(uncertain ? 'The follow-up result could not be confirmed. Reload the list before retrying.' : firstError(r))
    }
    toast?.(action === 'contacted' ? 'Marked as contacted.' : 'Follow-up closed.', 'success'); setClosing(false); onChanged()
  }
  return <li className={t.overdue ? 'fu-overdue' : ''}>
    <div><b>{owner ? `Due ${day(t.due_on)}` : `${t.patient.name} · ${t.patient.code}`}</b>
      <span><span className={`fd-badge ${TONE[t.status]}`}>{t.status}</span>{t.overdue ? <span className="fd-badge is-bad">Overdue</span> : ''} · {owner ? '' : `due ${day(t.due_on)} · `}{t.branch.name}{owner ? '' : ` · ${t.assignee}`}</span>
      {!owner && <span>{t.reason}{t.service ? ` · book: ${t.service.name}` : ''}{t.patient.phone ? ` · ${t.patient.phone}` : ''}</span>}
      {!owner && t.appointment && <span>Booked: {t.appointment.code} · {t.appointment.when}</span>}
      {!owner && t.close_note && <span>Closed: {t.close_note}</span>}
      {closing && <Field label="Why is it closed without a booking?" required><input value={note} disabled={!!busy || needsReload || !!taskRequest || staleRow} maxLength={500} onChange={e => setNote(e.target.value)}/></Field>}
      {staleRow && !taskRequest && <div role="alert"><p>This follow-up changed. Reload the list before continuing.</p><RefreshButton title="Reload follow-ups" ariaLabel="Reload follow-ups" onClick={onReload}/></div>}
      {taskRequest && taskRequest.phase !== 'pending' && <div role="alert"><p>The earlier follow-up update needs verification. An unchanged task does not confirm that it failed. Reload the list; if it remains unresolved, ask the branch team to review it before another action.</p><RefreshButton title="Reload follow-ups" ariaLabel="Reload follow-ups" onClick={onReload}/></div>}
      {(busy || taskRequest?.phase === 'pending') && <span role="status">{busy === 'review' ? 'Loading current follow-up state…' : (busy || taskRequest?.submitted.action) === 'close' ? 'Closing follow-up…' : 'Recording contact…'}</span>}
      {review && <div ref={reviewFeedback} tabIndex={-1} role={review.unavailable ? 'alert' : 'status'}>
        {review.unavailable ? <p>The current task could not be verified from this authorized list. Missing, stale or inaccessible data does not prove that an earlier booking failed. Ask the front desk to reconcile it.</p>
          : <><p>Current task status: {review.status}.{review.appointment && <> Linked appointment: {review.appointment.code || 'Recorded appointment'}{review.appointment.when ? ` · ${review.appointment.when}` : ''}.</>}</p><p>{review.appointment ? 'This shows the current relationship; it does not verify the original booking command.' : 'No linked appointment is shown in this response. This does not prove an earlier booking failed.'} Do not create a replacement for an unresolved booking.</p></>}
      </div>}
      {error && !taskRequest && !staleRow && <div role="alert"><p className="au-error">{error}</p><RefreshButton title="Reload follow-ups" ariaLabel="Reload follow-ups" onClick={onReload}/></div>}
    </div>
    {canWork && <div className="ns-actions">
      {t.can_book && role === 'staff' && <Button size="sm" disabled={!selection || !!busy || needsReload || !!taskRequest || staleRow} onClick={() => {
        if (!bookingToken.current && !pending.current && !pendingTasks?.tasks.has(t.id) && ownsRow()) {
          const selected = clinicalBookingSelection(latest.current.task, role, latest.current.store)
          if (!selected) return
          const captured = latest.current.task
          const task = Object.freeze({...captured,patient:Object.freeze({...captured.patient}),branch:Object.freeze({...captured.branch}),service:captured.service ? Object.freeze({...captured.service}) : null})
          const token = Object.freeze({selection:selected, task, prefill:Object.freeze({patientPublicId:t.patient.id,patientName:`${t.patient.name} • ${t.patient.code}`,branchId:t.branch.id,serviceId:t.service?.id || '',date:t.due_on})})
          bookingToken.current = token; setBooking(token)
        }
      }}>Book follow-up</Button>}
      {role === 'staff' && canSchedule(store, t.branch?.id) && <Button size="sm" variant="soft" disabled={!!busy} onClick={reviewCurrent}>Review current task</Button>}
      {t.can_contact && <Button size="sm" variant="soft" disabled={!!busy || needsReload || !!taskRequest || staleRow} onClick={() => act('contacted')}>Contacted</Button>}
      {t.can_close && !closing && <Button size="sm" variant="ghost" disabled={!!busy || needsReload || !!taskRequest || staleRow} onClick={() => (t.appointment ? act('close') : setClosing(true))}>Close</Button>}
      {closing && <>
        <Button size="sm" disabled={!!busy || needsReload || !!taskRequest || staleRow || note.trim().length < 3} onClick={() => act('close', { note })}>{busy === 'close' ? 'Closing…' : 'Close it'}</Button>
        <Button size="sm" variant="ghost" disabled={!!busy || needsReload || !!taskRequest || staleRow} onClick={() => { setClosing(false); setNote(''); setError('') }}>Cancel</Button>
      </>}
    </div>}
    {booking && <Modal open wide title={`Book a follow-up for ${t.patient.name}`} onClose={closeBooking}>
      <Notice tone="warning" title="Selected booking is not activated">This connection has not been verified for exact follow-up booking. No appointment can be submitted here. Contact the clinic system administrator. An earlier unverified booking must be reviewed before starting another.</Notice>
      <p>Selected patient: {booking.prefill.patientName}. Branch: {booking.task.branch.name}.{booking.task.service && <> Service: {booking.task.service.name}.</>} Requested date: {day(booking.prefill.date)}.</p>
      {/* No caller-created attestation is accepted here. The shared form stays closed until a separately reviewed running-backend gate exists. */}
      <SelectedFollowupBooking role={role} store={bookingStore} booking={booking}
        submitLabel="Book the follow-up" onSaved={(record, receipt) => { if (!ownsSelectedBooking()) return; pendingTasks.settlement++; rememberFollowup(pendingTasks, {id:booking.selection.taskId,patient:{id:booking.selection.patientPublicId},branch:{id:booking.selection.branchId},revision:receipt.followupLink.revision,status:'Booked'}); closeBooking(); toast?.('Selected follow-up booking verified. Reloading current task status.', 'success'); onChanged() }}/>
    </Modal>}
  </li>
}

function SelectedFollowupBooking({booking, role, store, onSaved, submitLabel}) {
  const t = booking.task
  return <AppointmentForm role={role} store={store} prefill={{ patientPublicId: t.patient.id, patientName: `${t.patient.name} • ${t.patient.code}`, branchId: t.branch.id, serviceId: t.service?.id || '', date: t.due_on }}
    serverFollowupSelection={booking.selection} onSaved={onSaved} submitLabel={submitLabel}/>
}

function BookingRecoveryNotice() {
  return <Notice tone="warning" title="Unverified earlier booking?">A booking whose result was not verified may already exist. Do not start a replacement booking. Review the current task and ask the front desk to reconcile it. Closing, navigating away or reloading loses a booking form’s retry details; current task information is not a receipt for the earlier command.</Notice>
}

export { clinicalBookingSelection, currentFollowupReview }

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
  const lifetime = followupLifetime(props.store)
  if (!lifetime.isCurrent()) return <Notice title="Follow-ups unavailable">Your follow-up session is unavailable. Sign in again before continuing.</Notice>
  return <PatientFollowupPanel {...props} lifetime={lifetime} key={JSON.stringify([lifetime.id, clinicalSessionKey(props.store?.session), role, props.patientId])} role={role}/>
}

function PatientFollowupPanel({ patientId, branches = [], toast, store, role, lifetime = followupLifetime(store) }) {
  const owner = role === 'owner', canCreate = ['staff', 'dentist'].includes(role)
  const {rows, error, load, isCurrent, pendingTasks} = useFollowupList(patientId, () => patientFollowups(patientId), patientId, owner, lifetime)
  const creation = pendingTasks.creates.get(patientId)
  const observedPendingAdd = creation?.phase === 'pending'
  const live = React.useRef(false), pending = React.useRef(creation || false)
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [needsReload, setNeedsReload] = useState(!!creation)
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(creation?.phase === 'pending'), [otherTouched, setOtherTouched] = useState(false)
  const [reasonCategory, setReasonCategory] = useState(STANDARD_REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [f, setF] = useState({ branch_ref: branches[0]?.id || '', due_on: manilaToday() }), [err, setErr] = useState('')
  const effectiveReason = reasonCategory === 'Other' ? customReason.trim() : reasonCategory
  const branchRef = f.branch_ref || branches[0]?.id || ''

  const recoveryRoot=React.useRef(null), recoveryFocus=React.useRef(false)
  React.useLayoutEffect(()=>{
    if(!recoveryFocus.current || !rows && !error)return
    recoveryFocus.current=false
    if(typeof document!=='undefined' && document.activeElement===document.body)recoveryRoot.current?.focus()
  },[rows,error])
  const reload = async () => {
    recoveryFocus.current=true
    const operation = pending.current
    const confirmed = await load()
    if (!live.current || !isCurrent() || !confirmed || pending.current !== operation || operation?.kind === 'request') return
    const unresolved = pendingTasks.creates.get(patientId)
    if (unresolved) {
      pending.current = unresolved; setNeedsReload(true); setBusy(unresolved.phase === 'pending')
      setErr('The earlier Add result is still unconfirmed. Review the list with the branch team before adding again; an empty list does not prove that it failed.')
      return
    }
    pending.current = false; setNeedsReload(false); setBusy(false); setErr('')
  }
  useEffect(() => {
    // A remounted panel's initial list read can reconcile a known create before
    // its own Reload callback runs. Release only that positively confirmed lock.
    if (!creation && pending.current?.phase === 'confirmed' && !pendingTasks.creates.has(patientId)) {
      pending.current = false; setBusy(false); setNeedsReload(false); setErr('')
    }
  }, [creation])
  useEffect(() => {
    if (!creation || creation.owner === pending || !observedPendingAdd) return
    let current = true
    creation.promise.then(() => { if (current && live.current && isCurrent()) reload() })
    return () => { current = false }
  }, [creation])
  const add = async e => {
    e.preventDefault()
    if (!live.current || !isCurrent() || pending.current || pendingTasks.creates.has(patientId) || !canCreate) return
    setErr('')
    if (!effectiveReason) { setOtherTouched(true); return setErr('Please select or enter a reason for follow-up.') }
    if (!branchRef || !f.due_on) return setErr('Choose a branch and due date.')
    const body = {patient_id: patientId, reason: effectiveReason, ...f, branch_ref: branchRef}
    const operation = {kind: 'request', phase: 'pending', body, token: {}, owner: pending}
    pendingTasks.creates.set(patientId, operation)
    pending.current = operation; setBusy(true)
    operation.promise = (async () => {
      let result
      try { result = await createFollowup(body) }
      catch { result = {ok: false, kind: 'network', message: 'The follow-up result could not be confirmed. Reload the list before retrying.'} }
      if (pendingTasks.creates.get(patientId)?.token === operation.token) {
        pendingTasks.settlement++
        const confirmed = result?.ok === true && result.data?.id && result.data?.patient?.id === body.patient_id && result.data?.branch?.id === body.branch_ref && result.data.status === 'Open' && Number.isSafeInteger(result.data.revision) && result.data.revision > 0
        operation.kind = 'reload'
        operation.phase = confirmed ? 'confirmed' : followupUncertain(result) ? 'recovery' : 'refused'
        if (confirmed) { operation.taskId = result.data.id; rememberFollowup(pendingTasks, result.data) }
        if (operation.phase === 'refused') pendingTasks.creates.delete(patientId)
      }
      return result
    })()
    const r = await operation.promise
    if (!live.current || !isCurrent()) return
    setBusy(false)
    const confirmed = r?.ok === true && r.data?.id && r.data?.patient?.id === body.patient_id && r.data?.branch?.id === body.branch_ref && r.data.status === 'Open' && Number.isSafeInteger(r.data.revision) && r.data.revision > 0
    if (!confirmed) {
      const uncertain = followupUncertain(r)
      pending.current = uncertain ? operation : false; setNeedsReload(uncertain)
      return setErr(uncertain ? 'The follow-up result could not be confirmed. Reload the list before retrying.' : firstError(r))
    }
    toast?.('Follow-up added.', 'success'); setAdding(false); setCustomReason('')
    // Keep duplicate submissions blocked until the successful write is reconciled.
    pending.current = operation; setNeedsReload(true)
    await reload()
  }
  return <section className="st-panel" ref={recoveryRoot} tabIndex={-1} aria-labelledby={`fu-${patientId}`}>
    <h3 id={`fu-${patientId}`} className="st-sub">Follow-ups</h3>
    {role === 'staff' && <BookingRecoveryNotice/>}
    {error && <Notice tone="error" title="Follow-ups unavailable">{error} <Button variant="soft" onClick={reload}>Reload follow-ups</Button></Notice>}
    {!rows ? !error && <p className="au-muted" role="status">Loading follow-ups…</p> : !rows.length ? <p className="au-muted" role="status">No follow-ups for this patient.</p>
      : <ul className="fd-list">{rows.map(t => <FollowupRow key={JSON.stringify([t.id, t.patient?.id, t.branch?.id, t.revision, t.service?.id, t.due_on, schedulingActorKey(store)])} t={t} pendingTasks={pendingTasks} owner={owner} role={role} store={store} toast={toast} onChanged={reload} onReload={reload} isCurrent={isCurrent}/>)}</ul>}
    {creation && !adding && <Notice tone="warning" title={creation.phase === 'pending' ? 'Follow-up Add pending' : 'Follow-up Add needs review'}>The earlier Add remains protected. Reload to review the list; do not assume an empty list means it failed. <Button variant="soft" onClick={reload}>Reload follow-ups</Button></Notice>}
    {canCreate && (adding ? <form className="au-form" aria-busy={busy} onSubmit={add}>
      <Field label="Branch" required><select required disabled={busy || needsReload} value={branchRef} onChange={e => setF(x => ({ ...x, branch_ref: e.target.value }))}>{!branches.length && <option value="">No available branch</option>}{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Follow-up reason" required hint="Seen by the branch team only, never by the patient.">
        <select disabled={busy || needsReload} value={reasonCategory} onChange={e => { setReasonCategory(e.target.value); setOtherTouched(false); if (e.target.value !== 'Other') setCustomReason('') }}>
          {STANDARD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {reasonCategory === 'Other' && <Field label="Specify reason" required error={otherTouched && !effectiveReason ? 'Specify the follow-up reason.' : undefined}><input disabled={busy || needsReload} value={customReason} maxLength={500} placeholder="Enter specific clinical reason…" onChange={e => setCustomReason(e.target.value)} onBlur={() => setOtherTouched(true)} required/></Field>}
      <Field label="Due" required><input disabled={busy || needsReload} type="date" value={f.due_on} onChange={e => setF(x => ({ ...x, due_on: e.target.value }))} required/></Field>
      {err && <p className="au-error" role="alert">{err}</p>}
      {busy && <p className="au-muted" role="status">Adding follow-up for this patient…</p>}
      {err && <Button variant="soft" disabled={busy} onClick={reload}>Reload follow-ups</Button>}
      <div className="ns-actions"><Button type="submit" size="sm" disabled={busy || needsReload || !effectiveReason || !branchRef || !f.due_on}>{busy ? 'Adding follow-up…' : 'Add follow-up'}</Button><Button size="sm" variant="ghost" disabled={busy || needsReload} onClick={() => setAdding(false)}>Cancel</Button></div>
    </form> : <Button size="sm" variant="soft" disabled={needsReload || !!creation || !branches.length} onClick={() => setAdding(true)}>Add a follow-up</Button>)}
  </section>
}
