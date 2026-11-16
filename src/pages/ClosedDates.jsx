import React, { useEffect, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterBar, Notice, PageHeader } from '../components.jsx'
import { changeClosure, closureAffected, createClosure, listClosures, notifyClosurePatients, suggestHolidays } from '../api-client.js'

const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'

/**
 * F5 closed and holiday dates (R2-13). The Owner closes a date for one branch or every branch (optional reason and partial hours),
 * removes a closure, and confirms or dismisses holiday suggestions one by one. Booking greys a closed date out at once. A closure
 * never cancels an appointment: the front desk (and Owner) see the appointments still booked that day and can email those
 * patients a reschedule link with one action.
 */
export function ClosedDatesPage({ store, role }) {
  const toast = store?.toast || (() => {})
  const owner = role === 'owner'
  const branches = (store?.state?.branches || []).filter(b => b.status !== 'Closed')
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [filterSearch, setFilterSearch] = useState(''), [filterBranch, setFilterBranch] = useState('All')
  const [form, setForm] = useState({ branch_ref: '', date: '', end_date: '', reason: '', partial: false, open_time: '09:00', close_time: '12:00' })
  const [formError, setFormError] = useState('')
  const load = () => listClosures().then(r => { if (r.ok) { setRows(r.data || []); setError('') } else setError(r.message || 'Closed dates could not be loaded.') })
  useEffect(() => { load() }, [])

  const preSaveConflicts = (form.date && store?.state?.appointments) ? store.state.appointments.filter(a => {
    if (['Cancelled'].includes(a.status)) return false
    const matchDate = form.end_date ? (a.date >= form.date && a.date <= form.end_date) : a.date === form.date
    if (!matchDate) return false
    if (form.branch_ref) {
      const bObj = branches.find(b => b.id === form.branch_ref)
      if (a.branchId !== form.branch_ref && a.branch !== bObj?.name) return false
    }
    return true
  }) : []

  const add = async e => {
    e.preventDefault()
    setBusy('add'); setFormError('')
    const r = await createClosure({ branch_ref: form.branch_ref || null, date: form.date, ...(form.end_date ? { end_date: form.end_date } : {}), reason: form.reason.trim() || null, ...(form.partial ? { open_time: form.open_time, close_time: form.close_time } : {}) })
    setBusy('')
    if (!r.ok) return setFormError(firstError(r))
    toast('Date closed. Booking shows it greyed out now.', 'success'); setForm(f => ({ ...f, date: '', end_date: '', reason: '' })); load()
  }
  const change = async (row, action, done) => {
    setBusy(row.id)
    const r = await changeClosure(row.id, action)
    setBusy('')
    if (!r.ok) return toast(firstError(r), 'warning')
    toast(done, 'success'); load()
  }
  const suggest = async () => {
    setBusy('suggest')
    const r = await suggestHolidays()
    setBusy('')
    if (!r.ok) return toast(firstError(r), 'warning')
    toast(r.data.added ? `${r.data.added} holiday suggestion(s) added. Confirm each one you close.` : 'No new holiday suggestions.', 'success'); load()
  }
  const active = (rows || []).filter(r => r.status === 'active'), suggested = (rows || []).filter(r => r.status === 'suggested')
  const visibleActive = active.filter(r => {
    if (filterBranch !== 'All' && r.branch && r.branch.id !== filterBranch) return false
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase()
      const d = (r.date || '').toLowerCase()
      const re = (r.reason || '').toLowerCase()
      const b = (r.branch?.name || '').toLowerCase()
      if (!d.includes(q) && !re.includes(q) && !b.includes(q)) return false
    }
    return true
  })

  return <div className="cd-page">
    <PageHeader kicker={owner ? 'Administration' : 'Front desk'} title="Closed dates"
      text="Days a branch is closed or keeps shorter hours. Closed days are greyed out in online booking with the reason, and the website lists upcoming closures. Appointments already booked are never cancelled automatically."/>
    {error && <Notice tone="warning" title="Unavailable">{error}</Notice>}
    {owner && <Card title="Close a date" subtitle="For one branch or every branch.">
      <form className="au-form cd-form" onSubmit={add}>
        <Field label="Branch"><select value={form.branch_ref} onChange={e => setForm(f => ({ ...f, branch_ref: e.target.value }))}>
          <option value="">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></Field>
        <Field label="Date" required><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required/></Field>
        <Field label="End date (optional for range)" hint="Leave blank for single-day closure."><input type="date" min={form.date || undefined} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}/></Field>
        <Field label="Reason (shown to patients)" hint="Optional, for example “Staff training”."><input value={form.reason} maxLength={120} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}/></Field>
        {preSaveConflicts.length > 0 && <div className="au-error-notice" style={{marginTop:'8px',marginBottom:'8px'}}>
          <Notice tone="warning" title="Existing appointments found">
            <p style={{margin:0}}>{preSaveConflicts.length} scheduled appointment(s) already exist on this date/range. A closure never cancels appointments automatically; front desk must notify or reschedule affected patients.</p>
            <ul style={{margin:'6px 0 0 16px',padding:0,fontSize:'12px'}}>
              {preSaveConflicts.slice(0, 10).map(a => (
                <li key={a.id}>
                  <b>{a.date} {a.time || a.start ? `at ${a.time || a.start}` : ''}</b> — {a.patientName || a.patientCode || 'Patient'}{a.serviceName || a.service ? ` (${a.serviceName || a.service})` : ''}
                </li>
              ))}
              {preSaveConflicts.length > 10 && <li>...and {preSaveConflicts.length - 10} more</li>}
            </ul>
          </Notice>
        </div>}
        <label className="au-check"><input type="checkbox" checked={form.partial} onChange={e => setForm(f => ({ ...f, partial: e.target.checked }))}/> Open only part of the day</label>
        {form.partial && <>
          <Field label="Opens"><input type="time" value={form.open_time} onChange={e => setForm(f => ({ ...f, open_time: e.target.value }))}/></Field>
          <Field label="Closes"><input type="time" value={form.close_time} onChange={e => setForm(f => ({ ...f, close_time: e.target.value }))}/></Field>
        </>}
        {formError && <p className="au-error" role="alert">{formError}</p>}
        <div className="au-actions"><Button type="submit" disabled={busy === 'add' || !form.date}>{busy === 'add' ? 'Saving…' : 'Close this date'}</Button></div>
      </form>
    </Card>}
    <Card title={`Upcoming closures (${active.length})`}>
      <FilterBar
        search={filterSearch}
        onSearchChange={setFilterSearch}
        searchPlaceholder="Filter closures by date or reason…"
        onClear={(filterSearch || filterBranch !== 'All') ? () => { setFilterSearch(''); setFilterBranch('All') } : null}
      >
        {branches.length > 1 && <select aria-label="Filter closures by branch" value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
          <option value="All">All branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
      </FilterBar>
      {!rows ? <p className="au-muted" role="status">Loading…</p> : !active.length ? <p className="au-muted">No upcoming closures.</p>
        : !visibleActive.length ? <p className="au-muted" role="status">No closures matching your filters.</p>
          : <ul className="fd-list">{visibleActive.map(c => <ClosureRow key={c.id} row={c} owner={owner} busy={busy} toast={toast} onRemove={() => change(c, 'remove', 'Closure removed. The date is bookable again.')}/>)}</ul>}
    </Card>
    {owner && <Card title={`Holiday suggestions (${suggested.length})`} subtitle="Philippine national holidays from the usual rules. Suggestions only: nothing closes until you confirm a date. Check the official proclamation for the year."
      actions={<Button size="sm" variant="soft" disabled={busy === 'suggest'} onClick={suggest}>{busy === 'suggest' ? 'Adding…' : 'Suggest holidays'}</Button>}>
      {!suggested.length ? <p className="au-muted">No suggestions waiting.</p> : <ul className="fd-list">{suggested.map(c => <li key={c.id}>
        <div><b>{longDate(c.date)}</b><span>{c.reason} · all branches · suggestion</span></div>
        <div className="ns-actions">
          <Button size="sm" disabled={busy === c.id} onClick={() => change(c, 'confirm', `${c.reason} is now closed.`)}>Close this date</Button>
          <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => change(c, 'dismiss', 'Suggestion dismissed.')}>Stay open</Button>
        </div>
      </li>)}</ul>}
    </Card>}
  </div>
}

function ClosureRow({ row, owner, busy, toast, onRemove }) {
  const [affected, setAffected] = useState(null), [meta, setMeta] = useState({}), [sending, setSending] = useState(false), [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { closureAffected(row.id).then(r => { if (r.ok) { setAffected(r.data || []); setMeta(r.meta || {}) } }) }, [row.id])
  const notify = async () => {
    setSending(true)
    const r = await notifyClosurePatients(row.id)
    setSending(false)
    if (!r.ok) return toast(firstError(r), 'warning')
    toast(`Emailed ${r.data.emailed} patient(s)${r.data.in_app_only ? `, ${r.data.in_app_only} in the app only` : ''}${r.data.already ? `, ${r.data.already} already told` : ''}.`, 'success')
    setMeta(m => ({ ...m, notified_at: new Date().toISOString() }))
  }
  return <li className="cd-row">
    <div><b>{longDate(row.date)}{row.partial_hours ? ` · open ${row.partial_hours.open}–${row.partial_hours.close} only` : ' · closed'}</b>
      <span>{row.branch?.name || 'All branches'}{row.reason ? ` · ${row.reason}` : ''}</span>
      {affected && (affected.length
        ? <span><b>{affected.length} appointment(s) still booked</b> (not cancelled): {affected.map(a => `${a.time} ${a.patient}`).join(', ')}{meta.notified_at ? ' · patients told' : ''}</span>
        : <span>No appointments booked that day.</span>)}
    </div>
    <div className="ns-actions">
      {affected?.length > 0 && <Button size="sm" variant="soft" icon="mail" disabled={sending || meta.wording_approved === false} title={meta.wording_approved === false ? 'The Owner must approve the “Closed date” email wording first' : undefined}
        onClick={notify}>{sending ? 'Sending…' : 'Email them a reschedule link'}</Button>}
      {owner && <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => setConfirmRemove(true)}>Remove</Button>}
    </div>
    <ConfirmDialog
      open={confirmRemove}
      title="Remove clinic closure?"
      confirmLabel="Remove closure"
      onConfirm={() => { setConfirmRemove(false); onRemove() }}
      onCancel={() => setConfirmRemove(false)}
    >
      <p>Removing the closure for <b>{longDate(row.date)}</b> reopens <b>{row.branch?.name || 'All branches'}</b> for online and front-desk booking on that date.</p>
    </ConfirmDialog>
  </li>
}
