import React, { useId, useRef, useState } from 'react'
import { Button, ConfirmDialog, Field, FilterBar, Modal, Notice, PageHeader, Status } from '../components.jsx'
import { patientName } from '../logic.js'
import { visibleHmo, HMO_PROVIDERS, pendingHmo } from '../phase3-contracts.js'
import { sessionForRole } from '../contracts.js'
import { commandKey } from '../appointments-api.js'
import { formatAmount } from '../pricing-api.js'
import { getHmoAttention, hmoCasesForView } from '../hmo-presentation.js'
import * as hmoApi from '../hmo-api.js'
import { canAccessPage } from '../safeguards.js'
import { PatientHmoPage } from './PatientCare.jsx'

// M12 HMO workspace (minimal server foundation). Staff operate SERVER cases for Visits in their branch scope and keep
// Patient HMO memberships; the Owner has read-only oversight. Every change is a server command followed by a refresh;
// browser HMO records appear only as read-only history. No provider is contacted, no file is stored (M14), nothing is
// sent (M18) and nothing runs on a timer (M23): the follow-up due time is derived by the server for display.
const METHODS = ['Portal', 'Email', 'Phone', 'In person']
const RULES = [['hmo-card', 'HMO Card'], ['valid-id', 'Valid ID'], ['treatment-request', 'Dentist treatment request']]
const stamp = value => (value ? String(value).replace('T', ' ').slice(0, 16) : '—')
const label = h => (h.legacy && ['Approved', 'Rejected', 'Returned'].includes(h.status) ? `Historical recorded ${h.status}` : ['Approved', 'Rejected', 'Returned'].includes(h.status) ? `Provider ${h.status}` : h.status === 'Withdrawn' ? 'Withdrawn — self-pay' : h.status)
const providerOf = h => h.providerName || HMO_PROVIDERS.find(p => p.id === h.providerId)?.name || 'Provider not recorded'
const EVENT_LABEL = { created: 'Case opened', requirement: 'Requirement checked at the clinic', submission: 'Submission recorded', contact: 'Contact attempt recorded', escalation: 'Case escalated', response: 'Provider response recorded', withdrawal: 'Withdrawn — no HMO claim (self-pay)' }

const useHmoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

// Reuse a key only for the same captured intent and payload. Edited requests need
// a new key because the existing server rejects key reuse with different payloads.
export function createHmoAttemptKeys(makeKey = commandKey) {
  const attempts = new WeakMap()
  return (owner, payload, initialKey) => {
    const last = attempts.get(owner)
    const fingerprint = JSON.stringify(payload)
    if (last?.fingerprint === fingerprint) return last.key
    const key = last ? makeKey() : (initialKey || makeKey())
    attempts.set(owner, { fingerprint, key }); return key
  }
}

export function captureHmoCase(h) {
  return { id: h.id, revision: h.revision, submissionCycle: h.submissionCycle, patientPublicId: h.patientPublicId, branchId: h.branchId, visitId: h.visitId, patientName: h.patientName, clinicDate: h.clinicDate }
}

export function hmoOperationIsStale(operation, current, selectedId) {
  if (!operation) return false
  const original = operation.caseSnapshot
  return !current || !current.server || current.id !== selectedId || current.id !== original.id ||
    !Number.isInteger(original.revision) || original.revision < 1 ||
    ['revision', 'submissionCycle', 'patientPublicId', 'branchId', 'visitId'].some(field => current[field] !== original[field])
}

export async function refreshHmoView(refresh) {
  try { const result = await refresh?.(); return result?.ok === true && !result.superseded } catch { return false }
}

// One synchronous guard for all HMO mutations in this workspace. The caller supplies
// the selection lifetime; server revision/idempotency checks remain authoritative.
export function createHmoCommandRunner({ allowed, refresh, onBusy, onFeedback }) {
  let active = false, pending = false, generation = 0
  const neutralFailure = result => result?.code === 'stale_revision' ? 'This HMO case changed. Close this dialog and review the latest case before trying again.'
    : result?.code === 'stale_membership' ? 'This Patient’s membership changed. Reload the membership and review it before trying again.'
    : result?.code === 'hmo_case_exists' ? 'This visit already has a case or self-pay decision. Review the latest list.'
    : result?.message || 'The operation could not be confirmed. Your input has been kept.'
  return {
    start() { active = true },
    stop() { active = false; generation++; pending = false },
    pending: () => pending,
    isActive: () => active,
    async run({ command, message, after, failed, current = () => true }) {
      if (!active || pending || !allowed() || !current()) return false
      const request = ++generation
      const valid = () => active && generation === request && allowed() && current()
      pending = true; onBusy(true)
      let confirmed = false
      try {
        const result = await command()
        if (!valid()) return false
        confirmed = result?.ok === true
        if (!confirmed) {
          failed?.(result)
          const needsRefresh = ['conflict', 'validation'].includes(result?.kind)
          const reloaded = needsRefresh ? await refreshHmoView(refresh) : true
          if (valid()) onFeedback(neutralFailure(result) + (!reloaded ? ' The latest view could not be reloaded.' : ''), 'warning', !reloaded)
          return false
        }
        const reloaded = await refreshHmoView(refresh)
        if (!valid()) return false
        after?.(result)
        onFeedback(message + (!reloaded ? ' The server confirmed this change, but the latest view could not be reloaded. Reload before another operation.' : ''), reloaded ? 'success' : 'warning', !reloaded)
        return true
      } catch {
        if (valid()) onFeedback(confirmed ? `${message} The server confirmed the change, but this view could not be updated. Reload before another operation.` : 'The operation could not be confirmed. Your input has been kept; retry uses the same command key.', 'warning', confirmed)
        return false
      } finally { if (generation === request) { pending = false; if (active) onBusy(false) } }
    },
  }
}

export function HmoPage(props) {
  const session = props.store.session || sessionForRole(props.role, props.store.state)
  const account = props.store.state.users.find(u => u.id === session?.userId)
  const identity = JSON.stringify([session?.serverUserId, session?.userId, session?.role, session?.active, session?.branchId, session?.branchScopes, account?.accountStatus || account?.status, account?.permissions, props.context?.hmoCaseId || null])
  return <HmoWorkspace key={identity} {...props}/>
}

function HmoWorkspace({ role, activeBranch, store, context }) {
  const { state, toast } = store
  const session = store.session || sessionForRole(role, state)
  const flow = store.appointmentFlow
  const staff = role === 'staff' && session?.role === 'staff' && !!session.serverUserId && canAccessPage(state, session, 'hmo')
  const scopes = Array.isArray(session?.branchScopes) ? session.branchScopes : []
  const claimDecisions = (state.claimDecisions || []).filter(d => scopes.includes(d.branchId))
  const all = visibleHmo(state, session).filter(h => !h.server || role !== 'staff' || scopes.includes(h.branchId)).filter(h => role !== 'owner' || !activeBranch || activeBranch === 'All Branches' || h.branch === activeBranch || h.branchName === activeBranch)
  const live = all.filter(h => h.server)
  const history = all.filter(h => !h.server)
  const [selectedId, setSelectedId] = useState(context?.hmoCaseId || '')
  React.useEffect(() => { if (context?.hmoCaseId) setSelectedId(context.hmoCaseId) }, [context?.hmoCaseId])
  const selected = all.find(h => h.id === selectedId) || null
  const [tab, setTab] = useState(role === 'owner' ? 'action' : 'all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [providerFilter, setProviderFilter] = useState('All')
  const viewId = useId(), detailHeading = useRef(null)
  const attention = h => getHmoAttention(h, state.clock)
  const shown = hmoCasesForView(live, tab, state.clock).filter(h => {
    if (statusFilter !== 'All') {
      const targetStatus = statusFilter === 'Self-Pay' ? 'Withdrawn' : statusFilter
      if (h.status !== targetStatus) return false
    }
    if (providerFilter !== 'All' && providerOf(h) !== providerFilter && h.providerId !== providerFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const pName = (h.patientName || patientName(h.patientId, state.patients)).toLowerCase()
      const prov = providerOf(h).toLowerCase()
      if (!pName.includes(q) && !prov.includes(q)) return false
    }
    return true
  })
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState(null)
  const [form, setForm] = useState({})
  const [decision, setDecision] = useState(null)
  const operationTrigger = useRef(null), feedbackRef = useRef(null)
  React.useEffect(() => {
    if (!operation && !decision && operationTrigger.current && !operationTrigger.current.isConnected) {
      (feedbackRef.current || detailHeading.current)?.focus({ preventScroll: true })
      operationTrigger.current = null
    }
  }, [operation, decision])
  const attemptKeys = useRef(null)
  if (!attemptKeys.current) attemptKeys.current = createHmoAttemptKeys()
  const directAttempts = useRef(new Map())
  const directKey = (kind, id, payload) => {
    const scope = `${kind}:${id}`
    if (!directAttempts.current.has(scope)) directAttempts.current.set(scope, {})
    return attemptKeys.current(directAttempts.current.get(scope), payload)
  }

  const reloadPending = useRef(false)
  const [feedback, setFeedback] = useState(null), [reloadNeeded, setReloadNeeded] = useState(false)
  const selection = useRef({ id: selectedId })
  if (selection.current.id !== selectedId) selection.current = { id: selectedId }
  const latest = useRef(null)
  latest.current = { staff, flow, reloadNeeded, live, decisions: claimDecisions }
  const runner = React.useMemo(() => createHmoCommandRunner({
    allowed: () => latest.current.staff,
    refresh: () => latest.current.flow?.refresh?.(),
    onBusy: setBusy,
    onFeedback: (message, tone, reload) => { setFeedback({ message, tone }); setReloadNeeded(reload); toast?.(message, tone) },
  }), [])
  useHmoLayoutEffect(() => { runner.start(); return () => runner.stop() }, [runner])
  const chooseCase = id => {
    if (runner.pending() || reloadPending.current) return
    selection.current = { id }; setSelectedId(id); setOperation(null); setForm({}); setFeedback(null)
  }
  const run = (command, message, after, current = () => true, failed) => {
    if (reloadPending.current || runner.pending()) return Promise.resolve(false)
    const lifetime = selection.current
    if (latest.current.reloadNeeded) return Promise.resolve(false)
    setFeedback(null)
    return runner.run({ command, message, after, failed, current: () => selection.current === lifetime && current() })
  }
  const reload = async () => {
    if (runner.pending() || reloadPending.current) return
    reloadPending.current = true
    const lifetime = selection.current
    setBusy(true)
    const ok = await refreshHmoView(() => flow?.refresh?.())
    if (runner.isActive() && latest.current.staff && selection.current === lifetime) { setReloadNeeded(!ok); setFeedback({ message: ok ? 'Latest HMO view reloaded. Review the case before continuing.' : 'The latest HMO view could not be reloaded. Try again.', tone: ok ? 'info' : 'warning' }) }
    reloadPending.current = false
    if (runner.isActive()) setBusy(false)
  }
  // Capture the revision and submission cycle when the dialog opens, not at confirm time.
  const operate = (mode, h, extra = {}) => {
    if (!staff || busy || runner.pending() || reloadNeeded || !h.server) return
    operationTrigger.current = typeof document === 'undefined' ? null : document.activeElement
    setOperation({ mode, caseId: h.id, caseSnapshot: captureHmoCase(h), key: commandKey() })
    setForm({ method: '', note: '', nextAction: '', outcome: '', approvedAmount: '', providerReference: '', returned: [], documentLabel: '', reason: '', rule: '', ...extra })
    setFeedback(null)
  }
  const currentCase = live.find(h => h.id === operation?.caseId)
  const operationStale = hmoOperationIsStale(operation, currentCase, selectedId)
  const confirmOperation = () => {
    if (!operation || operationStale || !staff) return
    const { mode, caseSnapshot: h } = operation
    const submitted = { ...form, returned: [...form.returned] }
    const key = attemptKeys.current(operation, { mode, caseId: h.id, revision: h.revision, submissionCycle: h.submissionCycle, submitted }, operation.key)
    const commands = {
      submit: () => hmoApi.submitCase(h, { method: submitted.method, note: submitted.note }, key),
      contact: () => hmoApi.recordContact(h, { method: submitted.method, note: submitted.note, nextAction: submitted.nextAction }, key),
      response: () => hmoApi.recordResponse(h, { outcome: submitted.outcome, method: submitted.method, note: submitted.note, providerReference: submitted.providerReference, approvedAmount: submitted.approvedAmount, returnedRequirements: submitted.returned }, key),
      withdraw: () => hmoApi.withdrawCase(h, submitted.reason, key),
      requirement: () => hmoApi.validateRequirement(h, submitted.rule, submitted.documentLabel.trim(), key),
    }
    const messages = { submit: 'External submission recorded.', contact: 'Contact attempt recorded.', response: 'Externally received provider response recorded.', withdraw: 'HMO claim withdrawn; the visit continues as self-pay.', requirement: 'Requirement checked at the clinic.' }
    if (commands[mode]) run(commands[mode], messages[mode], () => setOperation(null))
  }
  const decisionStale = !!decision && !claimDecisions.some(d => d.visitId === decision.visitId && d.patientId === decision.patientId && d.branchId === decision.branchId)

  if (role !== 'dentist' && !canAccessPage(state, session, 'hmo')) return <Notice tone="warning">HMO access is unavailable for this account.</Notice>
  if (role === 'patient') return <PatientHmoPage store={store} context={context}/>
  return <>
    <PageHeader title="HMO Management" text={staff ? 'Server HMO cases for visits in your branches: memberships, requirements, external submission, provider responses and follow-up.' : 'Clinic-wide HMO case oversight (read-only).'}/>
    <Notice tone="info">No provider is contacted by this application. Staff record what happened outside it; a provider decision exists only once Staff record the response received from the provider.</Notice>

    {feedback && !operation && !decision && <p ref={feedbackRef} role={feedback.tone === 'warning' ? 'alert' : 'status'} tabIndex={0}>{feedback.message}</p>}
    {staff && reloadNeeded && <Notice tone="warning" title="Latest view unavailable"><Button variant="ghost" disabled={busy} onClick={reload}>Reload HMO view</Button></Notice>}
    {staff && <ClaimDecisions rows={claimDecisions} busy={busy || reloadNeeded} onOpen={d => { if (latest.current.decisions.some(row => row.visitId === d.visitId)) run(() => hmoApi.openCase(d.visitId, directKey('open', d.visitId, { visitId: d.visitId })), 'HMO case opened.', r => setSelectedId(r.row?.id || '')) }} onSelfPay={d => { if (!runner.pending() && !reloadNeeded) { operationTrigger.current = typeof document === 'undefined' ? null : document.activeElement; setFeedback(null); setDecision({ ...d, intent: {}, reason: '', key: commandKey() }) } }}/>}
    {staff && <MembershipPanel store={store} busy={busy || reloadNeeded} run={run} pending={() => runner.pending()} onSelection={() => setFeedback(null)}/>}

    {role === 'owner' && <div className="hmo-metrics">{[
      ['Pending', live.filter(h => pendingHmo(h)).length],
      ['Missing requirements', live.filter(h => attention(h).label === 'Missing requirements').length],
      ['Approved', live.filter(h => h.status === 'Approved').length],
      ['Needs attention', live.filter(h => attention(h).needsAction).length],
    ].map(([name, count]) => <div className="mini-stat" key={name}><span>{name}</span><b>{count}</b></div>)}</div>}
    <div className="hmo-tabs" role="group" aria-label="HMO case views">{(staff ? [['all', 'All Cases'], ['action', 'Needs Action'], ['followups', 'Follow-Ups']] : [['action', 'Needs Attention'], ['all', 'All Cases']]).map(([key, name]) => {
      const count = hmoCasesForView(live, key, state.clock).length
      return <button type="button" aria-pressed={tab === key} key={key} aria-describedby={`${viewId}-${key}`} disabled={busy} onClick={() => { if (!runner.pending()) { setTab(key); chooseCase('') } }}>{name}<span aria-hidden="true">{count}</span><span hidden id={`${viewId}-${key}`}>{count} {count === 1 ? 'case' : 'cases'}</span></button>
    })}</div>
    <FilterBar
      className="hmo-filters"
      ariaLabel="Filter HMO cases"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Filter cases by patient name or provider…"
      onClear={(search || statusFilter !== 'All' || providerFilter !== 'All') ? () => { setSearch(''); setStatusFilter('All'); setProviderFilter('All') } : null}
    >
      <select aria-label="Filter HMO cases by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="All">All statuses</option>
        <option value="Missing Requirements">Missing Requirements</option>
        <option value="Ready for Submission">Ready for Submission</option>
        <option value="Pending">Pending</option>
        <option value="Approved">Approved</option>
        <option value="Rejected">Rejected</option>
        <option value="Returned">Returned</option>
        <option value="Self-Pay">Self-Pay</option>
      </select>
      <select aria-label="Filter HMO cases by provider" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}>
        <option value="All">All providers</option>
        {HMO_PROVIDERS.filter(p => !p.legacy).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
      </select>
    </FilterBar>
    <div className="hmo-workspace">
      <section className="hmo-case-list" aria-label="HMO cases">
        {!shown.length && <Notice>{live.length ? 'No cases match this view.' : 'No server HMO cases are available in your scope.'}</Notice>}
        {shown.map(h => <button type="button" className={`hmo-case-row${selectedId === h.id ? ' selected' : ''}`} key={h.id} disabled={busy} onClick={() => chooseCase(h.id)} aria-pressed={selectedId === h.id}>
          <span className="hmo-case-identity"><b>{h.patientName || patientName(h.patientId, state.patients)}</b><small>{h.branch} • visit {h.clinicDate}</small></span>
          <span>{providerOf(h)}</span>
          <Status>{label(h)}</Status>
          <span className="hmo-case-age">{attention(h).elapsed !== null ? `${Math.floor(attention(h).elapsed)}h pending` : ''}</span>
          <span className="hmo-case-attention">{attention(h).label}</span><span aria-hidden="true">›</span>
        </button>)}
        {history.length > 0 && <details className="hmo-history"><summary>Earlier browser records ({history.length}) — read-only history, not used for billing</summary>
          {history.map(h => <button type="button" className={`hmo-case-row${selectedId === h.id ? ' selected' : ''}`} key={h.id} disabled={busy} onClick={() => chooseCase(h.id)}>
            <span className="hmo-case-identity"><b>{patientName(h.patientId, state.patients)}</b><small>Historical record</small></span><span>{providerOf(h)}</span><Status>{label(h)}</Status>
          </button>)}
        </details>}
      </section>
      {selected && <CaseDetail key={selected.id} h={selected} staff={staff && selected.server} busy={busy || reloadNeeded} state={state} headingRef={detailHeading} onClose={() => chooseCase('')} operate={operate}
        onEscalate={h => run(() => hmoApi.escalateCase(captureHmoCase(h), directKey('escalate', h.id, { caseId: h.id, revision: h.revision })), 'Case escalated for clinic attention.')}/>}
    </div>

    <Modal open={!!operation} onClose={() => !busy && !runner.pending() && setOperation(null)} title={{ submit: 'Record external submission', contact: 'Record clinic contact attempt', response: 'Record externally received provider response', withdraw: 'Withdraw HMO claim (self-pay)', requirement: 'Check requirement at the clinic' }[operation?.mode] || ''}>
      {operation && <>
        {feedback && <p role="alert" tabIndex={0}>{feedback.message}</p>}
        <p>{operation.caseSnapshot.patientName || 'Selected Patient'} • {operation.caseSnapshot.clinicDate}</p>
        {operationStale && <Notice tone="warning">This case changed or is no longer selected. Cancel and reopen the current case before submitting.</Notice>}
        <fieldset disabled={busy || operationStale || reloadNeeded} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-busy={busy}>
        {operation.mode === 'requirement' && <><p>{RULES.find(([id]) => id === form.rule)?.[1]}</p><Field label="Document reference (optional)" hint="A label only — no file is stored."><input value={form.documentLabel} onChange={e => setForm({ ...form, documentLabel: e.target.value })}/></Field></>}
        {operation.mode === 'withdraw' && <><Notice tone="warning">Only before the first submission. The visit then continues as self-pay; this cannot be undone here.</Notice><Field label="Reason" required><textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}/></Field></>}
        {['submit', 'contact', 'response'].includes(operation.mode) && <Field label="Channel" required><select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}><option value="">Select channel</option>{METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>}
        {operation.mode === 'response' && <>
          <Field label="Provider outcome received" required><select value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value, approvedAmount: '', returned: [] })}><option value="">Select received outcome</option><option>Approved</option><option>Rejected</option><option>Returned</option></select></Field>
          {form.outcome === 'Approved' && <Field label="Approved amount (₱)" required hint="As stated by the provider, e.g. 1200.00. Billing caps it at the invoice amount."><input inputMode="decimal" value={form.approvedAmount} onChange={e => setForm({ ...form, approvedAmount: e.target.value })}/></Field>}
          {form.outcome === 'Returned' && <fieldset><legend>Requirements returned for correction</legend>{RULES.map(([id, name]) => <label className="check-control" key={id}><input type="checkbox" checked={form.returned.includes(id)} onChange={e => setForm({ ...form, returned: e.target.checked ? [...form.returned, id] : form.returned.filter(x => x !== id) })}/><span>{name}</span></label>)}</fieldset>}
          <Field label="Provider reference (optional)"><input value={form.providerReference} onChange={e => setForm({ ...form, providerReference: e.target.value })}/></Field>
        </>}
        {['submit', 'contact', 'response'].includes(operation.mode) && <Field label={operation.mode === 'response' ? 'Response details / pasted source text' : 'Internal tracking note / result'} required><textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}/></Field>}
        {operation.mode === 'contact' && <Field label="Next action" required><input value={form.nextAction} onChange={e => setForm({ ...form, nextAction: e.target.value })}/></Field>}
        </fieldset>
        <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setOperation(null)}>Cancel</Button><Button disabled={busy || operationStale || reloadNeeded} onClick={confirmOperation}>Save</Button></div>
      </>}
    </Modal>

    <Modal open={!!decision} onClose={() => !busy && !runner.pending() && setDecision(null)} title="Proceed as self-pay">{decision && <>
      {feedback && <p role="alert" tabIndex={0}>{feedback.message}</p>}
      {decisionStale && <Notice tone="warning">This visit no longer needs the same claim decision. Cancel and review the latest list.</Notice>}
      <p><b>{decision.patientName}</b> • visit {decision.clinicDate} • {decision.branchName}</p>
      <Notice tone="warning">This records that no HMO claim will be made for this visit (a final Withdrawn decision). Billing can then continue as self-pay.</Notice>
      <Field label="Reason" required><textarea disabled={busy || decisionStale || reloadNeeded} value={decision.reason} onChange={e => setDecision({ ...decision, reason: e.target.value })}/></Field>
      <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setDecision(null)}>Cancel</Button><Button disabled={busy || decisionStale || reloadNeeded} onClick={() => { if (!decisionStale) run(() => hmoApi.recordSelfPay(decision.visitId, decision.reason.trim(), attemptKeys.current(decision.intent, { visitId: decision.visitId, reason: decision.reason.trim() }, decision.key)), 'Self-pay decision recorded.', () => setDecision(null)) }}>Record self-pay decision</Button></div>
    </>}</Modal>
  </>
}

function ClaimDecisions({ rows, busy, onOpen, onSelfPay }) {
  return <section className="hmo-case-detail" aria-label="Claim decisions needed">
    <h2 className="hmo-section-title">Claim decisions needed</h2>
    <p className="block-muted">Visits whose Patient has an HMO membership on file but no HMO case yet. Billing is held until you open a case or record self-pay.</p>
    {!rows.length ? <Notice>No visits need a claim decision.</Notice> : rows.map(d => <div className="clinical-history" key={d.visitId}>
      <div><b>{d.patientName}</b><small className="block-muted">Visit {d.clinicDate} • {d.branchName}{d.appointmentCode ? ` • ${d.appointmentCode}` : ' • Walk-in'}</small></div>
      <div className="row-actions"><Button size="sm" disabled={busy} onClick={() => onOpen(d)}>Open HMO case</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => onSelfPay(d)}>Proceed self-pay</Button></div>
    </div>)}
  </section>
}

// A new object token on every select/reload protects A -> B -> A, even for the
// same Patient. Membership responses must name the exact server Patient requested.
export function createMembershipLookup(loadMembership, onChange) {
  let token = null, active = true
  const matches = (value, membership) => membership?.patient?.id === value.patientPublicId && Array.isArray(membership.history)
  return {
    capture: () => token,
    current: value => active && token === value,
    dispose() { active = false; token = null },
    async select(visit) {
      active = true
      const value = { visitId: visit.id, patientPublicId: visit.patientPublicId }
      token = value
      onChange({ membership: null, loading: true, error: '' })
      try {
        if (!value.patientPublicId) throw new Error('This Visit has no server Patient identity. Reload the visit list.')
        const result = await loadMembership(value.patientPublicId)
        if (!active || token !== value) return false
        if (!result.ok) throw new Error(result.message || 'Membership could not be loaded.')
        if (!matches(value, result.membership)) throw new Error('Membership could not be matched to this Patient. Reload before continuing.')
        onChange({ membership: result.membership, loading: false, error: '' }); return true
      } catch (error) {
        if (active && token === value) onChange({ membership: null, loading: false, error: error?.message || 'Membership could not be loaded.' })
        return false
      }
    },
    adopt(value, membership) {
      if (!active || token !== value) return false
      if (!matches(value, membership)) throw new Error('Membership response does not match the selected Patient.')
      onChange({ membership, loading: false, error: '' }); return true
    },
  }
}

export function MembershipPanel({ store, busy, run, pending, onSelection = () => {} }) {
  const { state, session } = store
  const scopes = Array.isArray(session?.branchScopes) ? session.branchScopes : []
  const visits = (state.visits || []).filter(v => v.server && scopes.includes(v.branchId)).slice().sort((a, b) => String(b.arrivedAt || '').localeCompare(String(a.arrivedAt || '')))
  const [visitId, setVisitId] = useState('')
  const visit = visits.find(v => v.id === visitId) || null
  return <details className="hmo-case-detail hmo-membership"><summary><b>Patient HMO membership</b></summary>
    <p className="block-muted">Recorded on the clinic server for the Patient of a visit in your branches. Staff enter the provider and member number; replacing them keeps the earlier record in history.</p>
    {visits.length ? <Field label="Visit"><select value={visit?.id || ''} disabled={busy} onChange={e => { if (!pending()) { onSelection(); setVisitId(e.target.value) } }}><option value="">Select a visit</option>{visits.map(v => <option key={v.id} value={v.id}>{v.patientName} ({v.patientCode}) • visit {v.clinicDate}</option>)}</select></Field>
      : <Notice>No visits in your branches right now. A membership is recorded from the Patient's visit.</Notice>}
    {visit && <VisitMembership key={`${visit.id}:${visit.patientPublicId}`} visit={visit} busy={busy} run={run} pending={pending}/>}
  </details>
}

export function VisitMembership({ visit, busy, run, pending }) {
  const [loaded, setLoaded] = useState({ membership: null, loading: true, error: '' })
  const [form, setForm] = useState({ providerName: '', memberNumber: '' })
  const [key, setKey] = useState(commandKey), [stale, setStale] = useState(false)
  const lookup = React.useMemo(() => createMembershipLookup(hmoApi.loadMembership, setLoaded), [])
  const attemptKeys = useRef(null)
  if (!attemptKeys.current) attemptKeys.current = createHmoAttemptKeys()
  useHmoLayoutEffect(() => { lookup.select(visit); return () => lookup.dispose() }, [lookup])
  const reloadMembership = () => { if (pending()) return; setStale(false); setKey(commandKey()); lookup.select(visit) }
  const save = end => {
    const lifetime = lookup.capture(), membership = loaded.membership
    if (busy || pending() || stale || !membership || !lookup.current(lifetime)) return
    const visitId = visit.id, activeId = membership.active?.id ?? null
    const submitted = { providerName: form.providerName.trim(), memberNumber: form.memberNumber.trim(), expectedActiveId: activeId }
    const capturedKey = attemptKeys.current(lifetime, { end, visitId, submitted }, key)
    run(() => end ? hmoApi.endMembership(visitId, activeId, capturedKey) : hmoApi.setMembership(visitId, submitted, capturedKey), end ? 'HMO membership ended.' : 'HMO membership saved.', result => {
      lookup.adopt(lifetime, result.membership)
      setForm({ providerName: '', memberNumber: '' }); setKey(commandKey()); setStale(false)
    }, () => lookup.current(lifetime), result => { if (result?.code === 'stale_membership') setStale(true) })
  }
  const membership = loaded.membership
  return <div aria-busy={busy || loaded.loading}>
    {loaded.loading && <p role="status">Loading the selected Patient’s membership…</p>}
    {(loaded.error || stale) && <div role="alert" tabIndex={0}><p>{loaded.error || 'This membership changed. Reload and review it before saving; your draft has been kept.'}</p><Button variant="ghost" disabled={busy} onClick={reloadMembership}>Reload membership</Button></div>}
    {membership && <>
      <p><b>{visit.patientName}</b> — {membership.active ? <>Active: {membership.active.provider_name} • {membership.active.member_number}</> : 'No active HMO membership'}</p>
      <fieldset disabled={busy || stale} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <Field label="Provider name" required><select value={form.providerName} onChange={e => setForm({ ...form, providerName: e.target.value })}><option value="">Select HMO provider</option>{HMO_PROVIDERS.filter(p => !p.legacy).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></Field>
          <Field label="Member number" required><input value={form.memberNumber} onChange={e => setForm({ ...form, memberNumber: e.target.value })}/></Field>
          <div className="form-actions span-2"><Button disabled={busy || stale || !form.providerName.trim() || !form.memberNumber.trim()} onClick={() => save(false)}>{membership.active ? 'Replace membership' : 'Save membership'}</Button>{membership.active && <Button variant="ghost" disabled={busy || stale} onClick={() => save(true)}>End membership</Button>}</div>
        </div>
      </fieldset>
      {membership.history.length > 0 && <ul className="hmo-timeline">{membership.history.map(m => <li key={m.id}><b>{m.provider_name} • {m.member_number}</b><time>{m.status === 'active' ? `Active since ${stamp(m.created_at)}` : `Ended ${stamp(m.ended_at)}`}</time></li>)}</ul>}
    </>}
  </div>
}

function CaseDetail({ h, staff, busy, state, headingRef, onClose, operate, onEscalate }) {
  const [confirmEscalate, setConfirmEscalate] = useState(null)
  const escalationStale = confirmEscalate && hmoOperationIsStale({ caseSnapshot: confirmEscalate }, h, h.id)
  const requirements = h.requirements || []
  const events = h.events || []
  const contacted = (h.contacts || []).some(c => c.submissionCycle === h.submissionCycle)
  const due = h.followUpDueAt && Date.parse(h.followUpDueAt) <= Date.parse(state.clock.timestamp)
  return <section className="hmo-case-detail" aria-label="HMO case detail">
    <div className="hmo-detail-head"><div><small>{h.server ? 'Case detail' : 'Historical browser record (read-only)'}</small><h2 ref={headingRef} tabIndex={-1}>{h.patientName || patientName(h.patientId, state.patients)}</h2><Status>{label(h)}</Status></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close case detail">×</button></div>
    {!h.server && <Notice tone="info">Recorded in an earlier browser-only version. It is not a server HMO case and never affects billing.</Notice>}
    <div className="hmo-detail-grid">
      <section><h3>Visit</h3><p>{h.branch} • {h.clinicDate || '—'}{h.appointmentCode ? ` • ${h.appointmentCode}` : ''}</p></section>
      <section><h3>HMO Provider</h3><p>{providerOf(h)}</p>{h.memberId && <p>Member ID: {h.memberId}</p>}</section>
      <section><h3>Requirements</h3><ul className="hmo-checklist">{requirements.map(r => <li key={r.id}><span aria-hidden="true">{r.state === 'Validated locally' ? '✓' : '!'}</span><div><b>{r.label}</b><small>{r.state}{r.documentLabel ? ` • ${r.documentLabel}` : ''}</small></div>
        {staff && ['Missing Requirements', 'Ready for Submission', 'Returned'].includes(h.status) && r.state !== 'Validated locally' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => operate('requirement', h, { rule: r.ruleId })}>Check {r.label}</Button>}</li>)}</ul></section>
      <section><h3>Request status</h3><p>Current status: <b>{label(h)}</b></p><p>Submitted: {h.submittedAt ? stamp(h.submittedAt) : 'Not submitted'}{h.submissionCycle > 1 ? ` (submission ${h.submissionCycle})` : ''}</p>
        {h.status === 'Approved' && <p>Approved amount: <b>{formatAmount(h.approvedAmount)}</b></p>}
        {(h.responses || []).map(r => <p key={r.id}><b>Provider response: {r.outcome}</b>{r.approvedAmount ? ` • ${formatAmount(r.approvedAmount)}` : ''}<br/>{stamp(r.recordedAt)} · {r.method}{r.providerReference ? ` · Ref ${r.providerReference}` : ''}<br/>{r.note}</p>)}
        {staff && <div className="row-actions">
          {h.status === 'Ready for Submission' && <Button size="sm" disabled={busy} onClick={() => operate('submit', h)}>{h.submissionCycle ? 'Record Resubmission' : 'Record External Submission'}</Button>}
          {pendingHmo(h) && <Button size="sm" disabled={busy} onClick={() => operate('response', h)}>Record Provider Response</Button>}
          {['Missing Requirements', 'Ready for Submission'].includes(h.status) && !h.submissionCycle && <Button size="sm" variant="ghost" disabled={busy} onClick={() => operate('withdraw', h)}>Withdraw (self-pay)</Button>}
        </div>}
      </section>
      <section><h3>Follow-Up</h3>
        {pendingHmo(h) && <p>Follow-up due: {stamp(h.followUpDueAt)}{due ? ' — due now' : ''}</p>}
        <p className="block-muted">Project follow-up threshold: 12 hours after submission. This is a clinic-side project setting, not a provider promise; nothing is sent or escalated automatically.</p>
        {(h.contacts || []).map(c => <p key={c.id}><b>{stamp(c.at)} · {c.method}</b><br/>{c.note}<br/>Next action: {c.nextAction}</p>)}
        {staff && pendingHmo(h) && <div className="row-actions"><Button size="sm" variant="ghost" disabled={busy} onClick={() => operate('contact', h)}>Record Contact Attempt</Button>{h.status === 'Pending' && due && contacted && <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmEscalate(captureHmoCase(h))}>Escalate Case</Button>}</div>}
      </section>
      {escalationStale && <Notice tone="warning">This case changed. Review the latest details before escalating.</Notice>}
      {confirmEscalate && !escalationStale && <ConfirmDialog
        open
        title="Escalate HMO case?"
        confirmLabel="Escalate case"
        tone="danger"
        onConfirm={() => { const captured = confirmEscalate; setConfirmEscalate(null); if (!escalationStale) onEscalate(captured) }}
        onCancel={() => setConfirmEscalate(null)}
      >
        <p>Are you sure you want to escalate this case for immediate supervisory review? This marks the case as escalated in the case history.</p>
      </ConfirmDialog>}
      {h.server && <section><h3>Case history</h3>{events.length ? <ol className="hmo-timeline">{events.map((e, i) => <li key={i}><b>{EVENT_LABEL[e.kind] || e.kind}{e.outcome ? `: ${e.outcome}` : ''}</b><time>{stamp(e.occurred_at)}{e.actor?.name ? ` • ${e.actor.name}` : ''}</time>{e.kind === 'withdrawal' && e.note && <small className="block-muted">Reason: {e.note}</small>}</li>)}</ol> : <p>{h.summaryOnly ? 'History is visible to clinic Staff.' : 'No events.'}</p>}</section>}
    </div>
  </section>
}
