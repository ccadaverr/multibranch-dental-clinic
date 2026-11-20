import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterBar, Modal, Notice, PageHeader, Status, Table } from '../components.jsx'
import { dateLabel, displayTime, patientName } from '../logic.js'
import { commandKey } from '../appointments-api.js'
import { isServerId } from '../appointments-api.js'
import { captureInquiry, closeInquiry, LIMITS, linkInquiryToAppointment, loadInquiries, respondToInquiry, SOURCES } from '../inquiries-api.js'

// M16 Staff inquiry worklist for a clinic-server session. Everything shown comes from the server; inquiry text is rendered as
// plain text (never HTML). It is truthful about what this module is: Staff type each inquiry in, the source is the channel Staff
// reported, "responded" records that Staff replied outside this system, and nothing is sent, delivered or synchronized.
const emptyForm = branchId => ({ branchId: branchId || '', source: SOURCES[0], name: '', contact: '', topic: '' })
const when = iso => (iso ? `${dateLabel(iso.slice(0, 10))} ${displayTime(iso.slice(11, 16))}` : '—')

export function ServerInquiriesPage({ store }) {
  const session = store.session
  const auth = store.getAuthGeneration?.()
  const allowed = !!session?.serverUserId && session.role === 'staff' && session.active === true &&
    Array.isArray(session.branchScopes) && session.branchScopes.includes(session.branchId) &&
    (!store.getAuthGeneration || auth != null)
  if (!allowed) return <Notice tone="warning" title="Inquiries unavailable">Your active Staff account and branch access could not be verified. Refresh your session before recording an inquiry.</Notice>
  const context = JSON.stringify([auth, session.serverUserId, session.userId, session.role, session.active, session.branchId, session.branchScopes])
  return <InquirySession key={context} store={store}/>
}

function InquirySession({ store }) {
  const { state, toast } = store
  const session = store.session
  const auth = store.getAuthGeneration?.(), live = useRef(false), pending = useRef(false), reading = useRef(0)
  const owns = () => live.current && auth === store.getAuthGeneration?.()
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; reading.current++ } }, [])
  const branches = (session?.branchScopes || []).map(id => ({ id, name: state.branches.find(b => b.id === id)?.name || id })); const sessionBranchId = session?.branchId && (!branches.length || branches.some(b => b.id === session.branchId)) ? session.branchId : ''
  const [rows, setRows] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [error, setError] = useState('')
  const [moreError, setMoreError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterSource, setFilterSource] = useState('All')

  const [closingInquiry, setClosingInquiry] = useState(null)
  const [form, setForm] = useState(() => emptyForm(sessionBranchId))
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(null)
  const [appointmentId, setAppointmentId] = useState('')
  const key = useRef(commandKey())
  const edit = patch => { if (!owns() || pending.current) return; key.current = commandKey(); setForm(previous => ({ ...previous, ...patch })) }

  const load = async () => {
    if (!owns()) return
    const ticket = ++reading.current
    setError('')
    setNextCursor(null); setLoadingMore(false)
    const result = await loadInquiries()
    if (!owns() || ticket !== reading.current) return
    if (result.ok) { setRows(result.rows); setNextCursor(result.nextCursor); setMoreError('') } else setError(result.message || 'Inquiries could not be loaded.')
  }
  useEffect(() => { load() }, [])
  const loadOlder = async () => {
    if (!owns() || !nextCursor || loadingMore) return
    const ticket = ++reading.current
    setLoadingMore(true); setMoreError('')
    const result = await loadInquiries(nextCursor)
    if (!owns() || ticket !== reading.current) return
    setLoadingMore(false)
    if (!result.ok) return setMoreError(result.message || 'Older inquiries could not be loaded.')
    setRows(previous => [...previous, ...result.rows.filter(r => !previous.some(p => p.id === r.id))]); setNextCursor(result.nextCursor)
  }

  const replace = row => setRows(previous => (previous || []).map(r => (r.id === row.id ? row : r)))
  const run = async (action, message) => {
    if (!owns() || pending.current) return false
    pending.current = true
    setBusy(true)
    let result
    try { result = await action() } catch { result = {ok:false,message:'The inquiry change could not be confirmed. Retry after checking the current record.'} }
    pending.current = false
    if (!owns()) return false
    setBusy(false)
    if (!result.ok) { toast(result.message, 'warning'); if (result.code === 'stale_revision' || result.kind === 'conflict') load(); return false }
    replace(result.row); toast(message, 'success'); return true
  }
  const add = async () => {
    if (!owns() || pending.current) return
    if (!sessionBranchId) return toast('Your active branch could not be determined for this session.', 'warning')
    const scopedForm = { ...form, branchId: sessionBranchId }
    pending.current = true
    setBusy(true)
    let result
    try { result = await captureInquiry(scopedForm, key.current) } catch { result = {ok:false,message:'The inquiry could not be confirmed. Retry the same unchanged request.'} }
    pending.current = false
    if (!owns()) return
    setBusy(false)
    if (!result.ok) return toast(result.message, 'warning')
    if (result.row?.branchId !== sessionBranchId) return toast('The recorded branch could not be confirmed. Refresh before retrying.', 'warning')
    load()
    setForm(emptyForm(sessionBranchId)); key.current = commandKey(); toast('Inquiry recorded and assigned to you.', 'success')
  }
  const link = async () => {
    if (!appointmentId) return toast('Choose the appointment that resulted from this inquiry.', 'warning')
    if (await run(() => linkInquiryToAppointment(linking, appointmentId, commandKey()), 'Inquiry linked to the existing appointment.')) { setLinking(null); setAppointmentId('') }
  }
  const linkable = linking ? state.appointments.filter(a => isServerId(a.id) && a.branchId === linking.branchId && a.status !== 'Cancelled') : []

  return <>
    <PageHeader title="Inquiries" text="Record and follow up on contacts from outside DentalOps."/>
    <p className="staff-inline-guidance">Manual tracking only. Replies are sent outside DentalOps; marking responded records that action, but does not send a message.</p>
    <details className="staff-inquiry-entry"><summary>Record new inquiry <span>Show form</span></summary>
    <Card title="Contact details"><div className="form-grid">

      <Field label="Source reported by Staff" required><select disabled={busy} value={form.source} onChange={e => edit({ source: e.target.value })}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Contact name" required><input disabled={busy} value={form.name} maxLength={LIMITS.name} onChange={e => edit({ name: e.target.value })}/></Field>
      <Field label="Contact handle or number"><input disabled={busy} value={form.contact} maxLength={LIMITS.contact} autoComplete="off" onChange={e => edit({ contact: e.target.value })}/></Field>
      <Field label="What they asked" required><textarea disabled={busy} value={form.topic} maxLength={LIMITS.topic} onChange={e => edit({ topic: e.target.value })}/></Field>
      {(()=>{
        const pot = (form.name.trim() || form.contact.trim()) ? (rows || []).find(r => {
          if (!sessionBranchId || r.branchId !== sessionBranchId) return false
          const n = form.name.trim().toLowerCase()
          const c = form.contact.trim().toLowerCase()
          if (n && r.name?.toLowerCase() === n) return true
          if (c && r.contact && r.contact.toLowerCase() === c) return true
          return false
        }) : null
        return pot ? <div className="span-2"><Notice tone="info">Potential duplicate: An inquiry from this contact ({pot.source}, status: {pot.status}) was already recorded for this branch on {when(pot.receivedAt)}.</Notice></div> : null
      })()}
      <Button className="span-2" disabled={busy} onClick={add}>Record inquiry</Button>
    </div></Card></details>
    {error && <Notice tone="warning" title="Inquiries could not be loaded">{error} <Button size="sm" onClick={load}>Retry</Button></Notice>}
    {!rows && !error && <p className="staff-inline-loading" role="status">Loading inquiries…</p>}
    {rows && (()=>{
      const visibleRows = (rows || []).filter(i => {
        if (filterStatus !== 'All' && i.status !== filterStatus) return false
        if (filterSource !== 'All' && i.source !== filterSource) return false
        if (!sessionBranchId || i.branchId !== sessionBranchId) return false
        if (filterSearch.trim()) {
          const q = filterSearch.trim().toLowerCase()
          const n = (i.name || '').toLowerCase()
          const t = (i.topic || '').toLowerCase()
          const c = (i.contact || '').toLowerCase()
          if (!n.includes(q) && !t.includes(q) && !c.includes(q)) return false
        }
        return true
      })
      return <Card className="top-gap" title="Inquiries" subtitle="Newest recorded first">
        <FilterBar
          search={filterSearch}
          onSearchChange={setFilterSearch}
          searchPlaceholder="Filter inquiries by contact or topic…"
          onClear={(filterSearch || filterStatus !== 'All' || filterSource !== 'All') ? () => { setFilterSearch(''); setFilterStatus('All'); setFilterSource('All') } : null}
        >
          <select aria-label="Filter inquiries by status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="All">All statuses</option>
            <option value="Open">Open</option>
            <option value="Responded">Responded</option>
            <option value="Closed">Closed</option>
            <option value="Converted">Converted</option>
          </select>
          <select aria-label="Filter inquiries by source" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="All">All sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>




        </FilterBar>
        {!rows.length && <Notice>No inquiries are assigned to you yet.</Notice>}
        {rows.length > 0 && !visibleRows.length && <Notice>No inquiries match your selected filters.</Notice>}
        {visibleRows.length > 0 && <Table rows={visibleRows} columns={[
          { key: 'source', label: 'Reported source', render: i => <div><b>{i.source}</b><small className="block-muted">{i.capture}</small></div> },
          { key: 'name', label: 'Contact', render: i => <div><b>{i.name}</b>{i.contact && <small className="block-muted">{i.contact}</small>}</div> },
          { key: 'topic', label: 'Inquiry', render: i => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{i.topic}</span> },
          { key: 'branch', label: 'Branch', render: i => i.branchName },
          { key: 'receivedAt', label: 'Recorded', render: i => when(i.receivedAt) },
          { key: 'status', label: 'Status', render: i => <div><Status>{i.status}</Status>{i.status === 'Responded' && <small className="block-muted">Replied outside this system {when(i.respondedAt)}</small>}</div> },
          { key: 'link', label: 'Appointment', render: i => (i.appointmentCode ? <div>{i.appointmentCode}{i.patientName && <small className="block-muted">{i.patientName}</small>}</div> : '—') },
          { key: 'actions', label: 'Actions', render: i => <div className="row-actions">
            {i.status === 'Open' && <Button size="sm" disabled={busy} onClick={() => run(() => respondToInquiry(i, commandKey()), 'Recorded that you responded outside this system.')}>Mark responded</Button>}
            {['Open', 'Responded'].includes(i.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setLinking(i); setAppointmentId('') }}>Link existing appointment</Button>}
            {['Open', 'Responded'].includes(i.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClosingInquiry(i)}>Close</Button>}
          </div> },
        ]}/>}
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <p className="muted" role="status">Showing {visibleRows.length} of {rows.length} inquir{rows.length === 1 ? 'y' : 'ies'}{nextCursor ? '. Older inquiries are available.' : '. That is all of them.'}</p>
          {moreError && <Notice tone="warning" title="Older inquiries unavailable">{moreError} <Button size="sm" variant="ghost" onClick={loadOlder}>Retry</Button></Notice>}
          {nextCursor && !moreError && <Button variant="soft" disabled={loadingMore} onClick={loadOlder}>{loadingMore ? 'Loading…' : 'Load older inquiries'}</Button>}
        </div>
        {closingInquiry && <ConfirmDialog
          open={!!closingInquiry}
          title="Close this inquiry?"
          confirmLabel="Close inquiry"
          onConfirm={() => { const target = closingInquiry; setClosingInquiry(null); run(() => closeInquiry(target, commandKey()), 'Inquiry closed.') }}
          onCancel={() => setClosingInquiry(null)}
        >
          <p>Are you sure you want to close this inquiry from <b>{closingInquiry.name}</b> ({closingInquiry.source})? This records the inquiry as closed.</p>
        </ConfirmDialog>}
      </Card>
    })()}
    <Modal open={!!linking} onClose={() => !busy && setLinking(null)} title="Link an existing appointment" subtitle="Choose an appointment that already exists in this branch. This records the link only; it does not book, change or cancel anything.">
      <Field label="Existing appointment"><select value={appointmentId} onChange={e => setAppointmentId(e.target.value)}><option value="">Select appointment</option>{linkable.map(a => <option key={a.id} value={a.id}>{dateLabel(a.date)} • {displayTime(a.start)} • {patientName(a.patientId, state.patients)} • {a.service}</option>)}</select></Field>
      {!linkable.length && <Notice>No linkable appointments are loaded for this branch.</Notice>}
      <Button className="full" disabled={busy} onClick={link}>Link appointment</Button>
    </Modal>
  </>
}
