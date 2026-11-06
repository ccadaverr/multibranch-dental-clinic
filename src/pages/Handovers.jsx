import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, Modal, Notice, PageHeader } from '../components.jsx'
import { useClinic } from '../store.jsx'
import { canAccessPage } from '../safeguards.js'
import { acknowledgeHandover, cancelHandover, createHandover, handover, handovers, listBranches, listDentists, listDocuments } from '../api-client.js'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'
const when = iso => iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : ''
const route = h => `${h.from.branch.name}${h.from.dentist ? ` (${h.from.dentist.name})` : ''} → ${h.to.branch.name}${h.to.dentist ? ` (${h.to.dentist.name})` : ''}`

// Response lifetimes are local guards, not server execution/idempotency guarantees.
const useHandoverLayoutEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect
const deniedResult = r => ['unauthenticated', 'forbidden', 'not_found'].includes(r?.kind)

export function handoverAccess(store, role = store?.session?.role) {
  const session = store?.session, account = store?.state?.users?.find(u => u.id === session?.userId)
  const enabled = !!store?.state && !!session?.serverUserId && role === session.role && ['staff', 'dentist', 'owner'].includes(role) && canAccessPage(store.state, session, 'handovers')
  return { key: JSON.stringify([session?.serverUserId, session?.userId, role, session?.active, session?.branchId, Array.isArray(session?.branchScopes) ? [...session.branchScopes].sort() : null, account?.accountStatus || account?.status, Array.isArray(account?.permissions) ? [...account.permissions].sort() : null, session?.dentistId, enabled]), enabled, clinical: enabled && role !== 'owner', owner: role === 'owner' }
}

export function handoverRows(data, patientId = null) {
  if (!Array.isArray(data) || data.some(row => typeof row?.id !== 'string' || !row.id || !row.patient?.id || !row.from?.branch || !row.to?.branch || (patientId && row.patient.id !== patientId))) throw Error('The handover list could not be matched to this context.')
  return data
}

export function handoverDetail(data, id, patientId = null, clinical = true) {
  if (!data || typeof data.id !== 'string' || !data.id || data.id !== id || !data.patient?.id || !data.from?.branch || !data.to?.branch || (patientId && data.patient.id !== patientId) || !['Sent', 'Acknowledged', 'Cancelled'].includes(data.status)) throw Error('This handover could not be matched to the selected record.')
  if (clinical) return data
  // Owner oversight never renders clinical text or document titles, even in an unexpected response.
  const { id: recordId, patient, from, to, status, created_at, acknowledged } = data
  return { id: recordId, patient, from, to, status, created_at, acknowledged, can_acknowledge: false, can_cancel: false }
}

export function createHandoverResource(load, project, publish, allowed = () => true) {
  let active = false, generation = 0
  return {
    start() { active = true },
    stop() { active = false; generation++ },
    async reload() {
      if (!active || !allowed()) return false
      const request = ++generation
      publish({ status: 'loading', data: null, error: '', denied: false })
      let result
      try {
        result = await load()
        if (!active || generation !== request || !allowed()) return false
        if (!result.ok) throw Error(result.message || 'Handovers could not be loaded.')
        const data = project(result.data)
        publish({ status: 'ready', data, error: '', denied: false }); return true
      } catch (error) {
        if (active && generation === request && allowed()) publish({ status: 'error', data: null, error: error?.message || 'The information could not be loaded.', denied: deniedResult(result) })
        return false
      }
    },
  }
}

function useHandoverResource(load, project, enabled) {
  const [snapshot, setSnapshot] = useState({ status: 'loading', data: null, error: '', denied: false })
  const current = useRef({ load, project, enabled }); current.current = { load, project, enabled }
  const resource = React.useMemo(() => createHandoverResource(() => current.current.load(), data => current.current.project(data), setSnapshot, () => current.current.enabled), [])
  useHandoverLayoutEffect(() => { resource.start(); if (enabled) resource.reload(); return () => resource.stop() }, [resource, enabled])
  return { ...snapshot, reload: () => resource.reload() }
}

export function createHandoverDetailLifecycle({ id, patientId, clinical = true, allowed = () => true, api, publish, changed = () => {}, feedback = () => {} }) {
  let active = false, generation = 0, lifetime = 0, pending = false, reading = false, attempted = false, opened = false, context = null
  let state = { data: null, loading: true, busy: false, error: '', transitionError: '', message: '', denied: false }
  const emit = patch => { state = { ...state, ...patch }; publish(state) }
  const valid = request => active && generation === request && allowed()
  const project = payload => {
    const data = handoverDetail(payload, id, patientId, clinical)
    if (!data.from.branch.id || !data.to.branch.id) throw Error('This handover has unavailable branch context.')
    const identity = JSON.stringify([data.patient.id, data.from.branch.id, data.to.branch.id, data.from.dentist?.id, data.to.dentist?.id, data.side])
    if (context !== null && context !== identity) throw Error('This handover no longer matches the opened Patient and care route. Close it and reopen the current record.')
    context = identity
    return data
  }
  const notifyChanged = async () => { try { await changed() } catch { /* The parent exposes its own retrieval error. */ } }
  const read = async automatic => {
    if (!active || pending || reading || !allowed()) return false
    reading = true
    const request = ++generation
    emit({ data: null, loading: true, error: '', message: '', denied: false })
    let result
    try {
      result = await api.get(id)
      if (!valid(request)) return false
      if (!result.ok) throw Error(result.message || 'This handover could not be opened.')
      const data = project(result.data)
      opened = true
      reading = false
      emit({ data, loading: false, error: '', denied: false,
        message: state.transitionError ? `Latest server status: ${data.status}. Review before trying again.` : '' })
      if (automatic && clinical && data.status === 'Sent' && data.can_acknowledge && !attempted) {
        attempted = true
        return transition('ack')
      }
      return true
    } catch (error) {
      if (valid(request)) emit({ data: null, loading: false, error: error?.message || 'This handover could not be opened.', denied: deniedResult(result) })
      return false
    } finally { if (generation === request) reading = false }
  }
  const transition = async type => {
    if (!active || pending || reading || !allowed() || !clinical || state.data?.status !== 'Sent' || !(type === 'ack' ? state.data.can_acknowledge : state.data.can_cancel)) return false
    if (state.data.side && state.data.side !== (type === 'ack' ? 'receiving' : 'sending')) return false
    pending = true
    const request = ++generation
    const operationLifetime = lifetime
    emit({ busy: true, transitionError: '', message: '' })
    let result
    try {
      result = await (type === 'ack' ? api.ack(id) : api.cancel(id))
      if (!valid(request)) return false
      if (!result.ok) throw Error(firstError(result))
      const data = project(result.data)
      const expected = type === 'ack' ? 'Acknowledged' : 'Cancelled'
      if (data.status !== expected) throw Error('The requested transition was not confirmed. Review the latest status.')
      emit({ data, busy: false, transitionError: '', error: '', denied: false, message: type === 'ack' ? 'Handover acknowledged.' : 'Handover cancelled.' })
      feedback(type === 'ack' ? 'Handover acknowledged.' : 'Handover cancelled.', 'success')
      await notifyChanged()
      return true
    } catch (error) {
      if (!valid(request)) return false
      const message = type === 'ack' ? 'Automatic acknowledgment was not confirmed.' : 'Cancellation was not confirmed.'
      if (deniedResult(result)) {
        emit({ data: null, loading: false, busy: false, denied: true, error: 'This handover is no longer available to this account.', transitionError: '' })
      } else {
        emit({ busy: false, transitionError: `${message} ${error?.message || 'Try again.'}` })
        // Reconcile already-transitioned records. This read must not automatically retry acknowledgment.
        pending = false
        await read(false)
      }
      if (active && lifetime === operationLifetime && allowed()) await notifyChanged()
      return false
    } finally { if (generation === request) { pending = false; if (valid(request)) emit({ busy: false }) } }
  }
  return {
    start() {
      if (active) return Promise.resolve(false)
      active = true; lifetime++; attempted = false; opened = false; context = null
      return read(true)
    },
    stop() { active = false; lifetime++; generation++; pending = false; reading = false },
    reload: () => read(false),
    // Initial retrieval recovery preserves first-open auto-ack. Reconciliation and
    // ordinary refreshes never restart a transition that was already attempted.
    recover: () => read(!opened && !attempted),
    retryAcknowledgment: () => transition('ack'),
    cancel: () => transition('cancel'),
    pending: () => pending || reading,
  }
}

export function createHandoverSubmission({ patientId, allowed, send, publish, confirmed }) {
  let active = false, pending = false, generation = 0
  return {
    start() { active = true },
    stop() { active = false; generation++; pending = false },
    pending: () => pending,
    async submit(form, documentIds) {
      if (!active || pending || !allowed()) return false
      const request = ++generation
      const payload = { ...form, patient_id: patientId, document_ids: [...documentIds], to_dentist_ref: form.to_dentist_ref || null, pending_treatment: form.pending_treatment || null, notes: form.notes || null }
      pending = true; publish({ busy: true, error: '', denied: false })
      let result
      try {
        result = await send(payload)
        if (!active || generation !== request || !allowed()) return false
        if (!result.ok) throw Error(firstError(result))
        handoverDetail(result.data, result.data?.id, patientId)
        confirmed(result.data)
        return true
      } catch (error) {
        if (active && generation === request && allowed()) publish({ busy: false, error: error?.message || 'The handover could not be confirmed. Your draft has been kept.', denied: deniedResult(result) })
        return false
      } finally { if (generation === request) { pending = false; if (active) publish({ busy: false }) } }
    },
  }
}

/** Inbox rows are metadata; clinical content is fetched only for the selected handover. */
export function HandoversPage({ store, role }) {
  const access = handoverAccess(store, role)
  return <HandoverInbox key={access.key} store={store} role={role} access={access}/>
}

function HandoverInbox({ store, role, access }) {
  const [tab, setTab] = useState('todo'), [openId, setOpenId] = useState(null)
  const inboxRegion = useRef(null), opener = useRef(null)
  useEffect(() => { if (!openId && opener.current) { (opener.current.isConnected ? opener.current : inboxRegion.current)?.focus({ preventScroll: true }); opener.current = null } }, [openId])
  const list = useHandoverResource(handovers, data => handoverRows(data).map(h => access.owner ? handoverDetail(h, h.id, null, false) : h), access.enabled)
  useEffect(() => { if (list.denied) setOpenId(null) }, [list.denied])
  const rows = list.data || [], todo = rows.filter(h => h.can_acknowledge)
  const shown = access.owner || tab === 'all' ? rows : todo
  return <div ref={inboxRegion} tabIndex={-1} className="st-page">
    <PageHeader kicker={access.owner ? 'Administration' : 'Patients'} title="Patient handovers"
      text={access.owner ? 'When a patient’s care moves to another branch or dentist. You see who, when, from and to; clinical notes are visible only to the sending and receiving teams.' : 'Open a handover sent to you to view it. Eligible receiving users automatically acknowledge it on opening.'}/>
    {!access.enabled ? <Notice tone="warning">Handovers require an active authorized clinic-server session.</Notice> : <>
      {list.error && <Notice tone="error" title="Handovers unavailable">{list.error} <Button variant="ghost" onClick={list.reload}>Retry handovers</Button></Notice>}
      {!access.owner && <div className="st-tabs" role="tablist" aria-label="Handovers">
        <button type="button" role="tab" aria-selected={tab === 'todo'} className={tab === 'todo' ? 'is-on' : ''} onClick={() => setTab('todo')}>To acknowledge ({list.status === 'ready' ? todo.length : '—'})</button>
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>All</button>
      </div>}
      <Card>
        {list.status === 'loading' ? <p className="au-muted" role="status">Loading handovers…</p> : list.status === 'ready' && (!shown.length ? <p className="au-muted">{tab === 'todo' && !access.owner ? 'Nothing to acknowledge.' : 'No handovers yet.'}</p>
          : <ul className="fd-list">{shown.map(h => <li key={h.id}>
            <div><b>{h.patient.name} · {h.patient.code}</b><span>{route(h)}</span><span>{h.status}{h.acknowledged ? ` by ${h.acknowledged.by}, ${when(h.acknowledged.at)}` : ''} · sent {when(h.created_at)}{h.from.by ? ` by ${h.from.by}` : ''}</span></div>
            {!access.owner && <Button size="sm" variant={h.can_acknowledge ? 'primary' : 'soft'} onClick={event => { opener.current = event.currentTarget; setOpenId({ id: h.id, patientId: h.patient.id }) }}>{h.can_acknowledge ? 'Open (Auto-accept)' : 'Open'}</Button>}
          </li>)}</ul>)}
      </Card>
      {openId && !list.denied && <HandoverDialog id={openId.id} patientId={openId.patientId} access={access} toast={store?.toast} onClose={() => setOpenId(null)} onChanged={list.reload}/>}
    </>}
  </div>
}

export function HandoverDialog(props) {
  const access = props.access || handoverAccess(props.store)
  return <HandoverDetailDialog key={JSON.stringify([access.key, props.id, props.patientId])} {...props} access={access}/>
}

function HandoverDetailDialog({ id, patientId, access, toast, onClose, onChanged }) {
  const [snapshot, setSnapshot] = useState({ data: null, loading: true, busy: false, error: '', transitionError: '', denied: false })
  const [confirmCancel, setConfirmCancel] = useState(false)
  const current = useRef(null); current.current = { access, toast, onChanged }
  const controller = React.useMemo(() => createHandoverDetailLifecycle({ id, patientId, clinical: access.clinical,
    allowed: () => current.current.access.enabled && current.current.access.key === access.key,
    api: { get: handover, ack: acknowledgeHandover, cancel: cancelHandover }, publish: setSnapshot,
    changed: () => current.current.onChanged?.(), feedback: (...args) => current.current.toast?.(...args),
  }), [])
  useHandoverLayoutEffect(() => { if (access.enabled) controller.start(); return () => controller.stop() }, [controller, access.enabled])
  const h = access.enabled ? snapshot.data : null
  return <Modal open title={h ? `Handover: ${h.patient.name}` : 'Handover'} onClose={onClose}>
    {!access.enabled ? <Notice tone="warning">This account cannot open the handover.</Notice> : <>
      {snapshot.error && <Notice tone="error" title="Handover unavailable">{snapshot.error} <Button variant="ghost" disabled={snapshot.busy || snapshot.loading} onClick={controller.recover}>Retry handover</Button></Notice>}
      {snapshot.transitionError && <p role="alert" tabIndex={0}>{snapshot.transitionError}</p>}
      {snapshot.message && <p role="status">{snapshot.message}</p>}
      {snapshot.busy && <p role="status">Updating handover status…</p>}
      {snapshot.loading && <p className="au-muted" role="status">Loading handover…</p>}
      {h && <div className="st-handover" aria-busy={snapshot.busy} style={{ overflowWrap: 'anywhere' }}>
        <p className="au-muted">{route(h)} · sent {when(h.created_at)}{h.from.by ? ` by ${h.from.by}` : ''} · {h.status}{h.acknowledged ? ` by ${h.acknowledged.by}` : ''}</p>
        {access.clinical && h.summary !== undefined ? <dl className="st-dl" style={{ whiteSpace: 'pre-wrap' }}>
          <dt>Summary</dt><dd>{h.summary}</dd>
          {h.pending_treatment && <><dt>Pending treatment</dt><dd>{h.pending_treatment}</dd></>}
          {h.notes && <><dt>Notes for the next dentist</dt><dd>{h.notes}</dd></>}
          <dt>Documents</dt><dd>{h.documents?.length ? <ul>{h.documents.map(d => <li key={d.id}>{d.title} · {d.category} · {d.date}</li>)}</ul> : 'None attached.'}</dd>
        </dl> : <Notice tone="info">Clinical notes and document titles are visible only to the authorized sending and receiving teams.</Notice>}
        <div className="ns-actions">
          {access.clinical && snapshot.transitionError && h.status === 'Sent' && h.can_acknowledge && <Button variant="ghost" disabled={snapshot.busy || snapshot.loading} onClick={controller.retryAcknowledgment}>Retry automatic acknowledgment</Button>}
          {access.clinical && h.can_cancel && h.status === 'Sent' && <Button variant="ghost" disabled={snapshot.busy || snapshot.loading} onClick={() => { if (!controller.pending()) setConfirmCancel(true) }}>Cancel handover</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <ConfirmDialog open={confirmCancel && h.status === 'Sent' && !!h.can_cancel && !snapshot.busy}
          title="Cancel patient handover?" confirmLabel="Cancel handover"
          onConfirm={() => { setConfirmCancel(false); controller.cancel() }} onCancel={() => setConfirmCancel(false)}>
          <p>Cancelling withdraws this handover to <b>{h.to?.branch?.name || 'the receiving branch'}</b> and revokes temporary cross-branch handover access.</p>
        </ConfirmDialog>
      </div>}
    </>}
  </Modal>
}

// The existing record-page caller supplies only Patient ID and toast. Read its
// current authenticated identity from the existing provider without changing that caller.
export function HandoverPanel(props) {
  if (!props.store) return <ClinicHandoverPanel {...props}/>
  const access = handoverAccess(props.store)
  return <PatientHandovers key={JSON.stringify([access.key, props.patientId])} {...props} access={access}/>
}
function ClinicHandoverPanel(props) {
  const store = useClinic()
  return <HandoverPanel {...props} store={store}/>
}

function PatientHandovers({ patientId, toast, access }) {
  const [creating, setCreating] = useState(false), [openId, setOpenId] = useState(null)
  const panelRegion = useRef(null), opener = useRef(null)
  useEffect(() => { if (!openId && opener.current) { (opener.current.isConnected ? opener.current : panelRegion.current)?.focus({ preventScroll: true }); opener.current = null } }, [openId])
  const list = useHandoverResource(() => handovers({ patient_id: patientId }), data => handoverRows(data, patientId).map(h => access.owner ? handoverDetail(h, h.id, patientId, false) : h), access.enabled && !!patientId)
  useEffect(() => { if (list.denied) { setCreating(false); setOpenId(null) } }, [list.denied])
  const createControl = useRef(null), returnFocus = useRef(false)
  useEffect(() => { if (!creating && returnFocus.current) { createControl.current?.querySelector('button')?.focus(); returnFocus.current = false } }, [creating])
  const closeForm = () => { returnFocus.current = true; setCreating(false) }
  return <section ref={panelRegion} tabIndex={-1} className="st-panel" aria-labelledby={`ho-${patientId}`}>
    <h3 id={`ho-${patientId}`} className="st-sub">Handovers</h3>
    {!access.enabled || !patientId ? <Notice tone="warning">Patient handovers are unavailable for this account.</Notice> : <>
      {list.error && <Notice tone="error" title="Patient handovers unavailable">{list.error} <Button variant="ghost" onClick={list.reload}>Retry patient handovers</Button></Notice>}
      {list.status === 'loading' && <p className="au-muted" role="status">Loading handovers…</p>}
      {list.status === 'ready' && (!list.data.length ? <p className="au-muted">No handovers for this patient.</p>
        : <ul className="fd-list">{list.data.map(h => <li key={h.id}><div><b>{route(h)}</b><span>{h.status} · {when(h.created_at)}</span></div>
          {!access.owner && <Button size="sm" variant={h.can_acknowledge ? 'primary' : 'soft'} onClick={event => { opener.current = event.currentTarget; setOpenId(h.id) }}>{h.can_acknowledge ? 'Open (Auto-accept)' : 'Open'}</Button>}</li>)}</ul>)}
      {!list.denied && access.clinical && (creating ? <HandoverForm key={patientId} patientId={patientId} access={access} toast={toast} onCancel={closeForm} onDone={() => { closeForm(); list.reload() }}/>
        : <div ref={createControl}><Button size="sm" variant="soft" onClick={() => setCreating(true)}>Hand over care</Button></div>)}
      {openId && !list.denied && <HandoverDialog id={openId} patientId={patientId} access={access} toast={toast} onClose={() => setOpenId(null)} onChanged={list.reload}/>}
    </>}
  </section>
}

export function handoverReferences(data, patientId) {
  if (!Array.isArray(data?.branches) || !Array.isArray(data?.dentists) || !Array.isArray(data?.docs)) throw Error('Handover choices could not be loaded.')
  const docs = data.docs.filter(d => d.status === 'Active')
  if (docs.some(d => d.patient?.id !== patientId)) throw Error('Documents could not be matched to this Patient. Reload the choices.')
  return { branches: data.branches.filter(b => b.status !== 'Closed'), dentists: data.dentists, docs }
}

function HandoverForm({ patientId, access, toast, onCancel, onDone }) {
  const [picked, setPicked] = useState([])
  const formRef = useRef(null)
  const [f, setF] = useState({ from_branch_ref: '', to_branch_ref: '', to_dentist_ref: '', summary: '', pending_treatment: '', notes: '' })
  const [result, setResult] = useState({ busy: false, error: '', denied: false }), [attachmentNotice, setAttachmentNotice] = useState('')
  const current = useRef(null); current.current = { access, toast, onDone }
  const refs = useHandoverResource(async () => {
    const results = await Promise.all([listBranches(), listDentists(), listDocuments({ patient_id: patientId })])
    const failed = results.find(deniedResult) || results.find(r => !r.ok)
    return failed || { ok: true, data: { branches: results[0].data, dentists: results[1].data, docs: results[2].data } }
  }, data => handoverReferences(data, patientId), access.clinical)
  const sender = React.useMemo(() => createHandoverSubmission({ patientId, allowed: () => current.current.access.clinical, send: createHandover,
    publish: patch => setResult(previous => ({ ...previous, ...patch })), confirmed: () => { current.current.toast?.('Handover recorded.', 'success'); current.current.onDone() },
  }), [])
  useHandoverLayoutEffect(() => { sender.start(); return () => sender.stop() }, [sender])
  useEffect(() => {
    if (refs.status !== 'ready') return
    const available = new Set(refs.data.docs.map(d => d.id))
    const retained = picked.filter(id => available.has(id))
    if (retained.length !== picked.length) { setPicked(retained); setAttachmentNotice('Some selected documents are no longer available. Review attachments before sending.') }
    if (document.activeElement === document.body) formRef.current?.querySelector('select:not(:disabled)')?.focus()
  }, [refs.data])
  const set = (k, v) => { if (!sender.pending()) setF(x => ({ ...x, [k]: v, ...(k === 'to_branch_ref' ? { to_dentist_ref: '' } : {}) })) }
  const submit = e => { e.preventDefault(); if (refs.status === 'ready' && !result.denied && !refs.denied) sender.submit(f, picked) }
  const { branches = [], dentists = [], docs = [] } = refs.data || {}
  const atTarget = dentists.filter(d => (d.branch_ids || []).includes(f.to_branch_ref))
  if (result.denied || refs.denied || !access.clinical) return <Notice tone="error" title="Handover unavailable">Access to this Patient or handover operation was lost. Clinical draft fields are hidden. <Button variant="ghost" onClick={onCancel}>Close handover form</Button></Notice>
  return <form ref={formRef} className="au-form st-handover-form" aria-label="Create Patient handover" aria-busy={result.busy || refs.status === 'loading'} onSubmit={submit}>
    {refs.status === 'loading' && <p role="status">Loading handover choices and authorized documents…</p>}
    {refs.error && <Notice tone="error" title="Handover choices unavailable">{refs.error} <Button variant="ghost" onClick={refs.reload}>Retry handover choices</Button></Notice>}
    {result.error && <p className="au-error" role="alert" tabIndex={0}>{result.error}</p>}
    {attachmentNotice && <p role="status">{attachmentNotice}</p>}
    <fieldset disabled={result.busy || refs.status !== 'ready'} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="st-pair">
        <Field label="From branch" required><select value={f.from_branch_ref} onChange={e => set('from_branch_ref', e.target.value)} required><option value="">Choose…</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="To branch" required><select value={f.to_branch_ref} onChange={e => set('to_branch_ref', e.target.value)} required><option value="">Choose…</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </div>
      <Field label="Receiving dentist" hint="Optional. Without one, the receiving front desk acknowledges it."><select value={f.to_dentist_ref} onChange={e => set('to_dentist_ref', e.target.value)} disabled={!f.to_branch_ref}>
        <option value="">Any dentist there</option>{atTarget.map(d => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}</select></Field>
      <Field label="Summary" required hint="Visible only to the sending and receiving teams, never to the patient."><textarea maxLength={2000} value={f.summary} onChange={e => set('summary', e.target.value)} required/></Field>
      <Field label="Pending treatment"><textarea maxLength={2000} value={f.pending_treatment} onChange={e => set('pending_treatment', e.target.value)}/></Field>
      <Field label="Notes for the next dentist"><textarea maxLength={2000} value={f.notes} onChange={e => set('notes', e.target.value)}/></Field>
      {docs.length > 0 && <fieldset className="st-docs" style={{ overflowWrap: 'anywhere' }}><legend>Attach existing documents (the receiving team sees their titles)</legend>
        {docs.map(d => <label key={d.id} className="au-check"><input type="checkbox" checked={picked.includes(d.id)} onChange={e => { if (!sender.pending()) setPicked(p => e.target.checked ? [...p, d.id] : p.filter(id => id !== d.id)) }}/> {d.title} <small>{d.category}</small></label>)}
      </fieldset>}
      <div className="ns-actions"><Button type="submit" disabled={result.busy || !f.summary.trim() || !f.from_branch_ref || !f.to_branch_ref}>{result.busy ? 'Recording…' : 'Send handover'}</Button></div>
    </fieldset>
    <Button variant="ghost" disabled={result.busy} onClick={() => { if (!sender.pending()) onCancel() }}>Cancel</Button>
  </form>
}
