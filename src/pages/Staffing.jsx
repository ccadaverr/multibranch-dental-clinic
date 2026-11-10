import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterBar, Notice, PageHeader } from '../components.jsx'
import {
  addScheduleException, cancelLeave, copyProfileHours, decideLeave, leaveCalendar, leaveConflicts, leaveRequests, myLeave, notifyLeaveAffected,
  notifyScheduleAffected, removeScheduleException, requestLeave, saveWeeklyHours, scheduleAffected, updateStaffProfile, workSchedules,
} from '../api-client.js'
import { commandKey, rescheduleAppointment } from '../appointments-api.js'
import { dutyForBranch } from '../work-hours-duty.js'
import '../den12-work-hours.css'
import { schedulingActorKey, useRequestOwner } from '../appointment-ui.js'
import { canAccessPage } from '../safeguards.js'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'
const t12 = hm => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const manilaToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

/**
 * Appointments a schedule change, a day off or approved leave left without their dentist (M3/M15). Never cancelled: each row
 * shows suggested cover (another dentist at the branch who is free then) with a one-click move through the normal reschedule
 * command, and the list has one action to email those patients a reschedule link (Owner-approved wording only).
 */
export function AffectedAppointments({ rows, wordingApproved, onNotify, onChanged, toast, canAct = true }) {
  const [busy, setBusy] = useState('')
  if (!rows) return null
  if (!rows.length) return <p className="au-muted">No booked appointments are affected.</p>
  const move = async (a, dentist) => {
    setBusy(a.id + dentist.id)
    const r = await rescheduleAppointment({ id: a.id, revision: a.revision }, { date: a.date, start: a.start_time, dentistId: dentist.id }, commandKey())
    setBusy('')
    if (!r.ok) return toast(r.message || 'The appointment could not be moved. Reload and try again.', 'warning')
    toast(`${a.patient} is now with ${dentist.name} at the same time.`, 'success'); onChanged?.()
  }
  const notify = async () => {
    setBusy('notify')
    const r = await onNotify()
    setBusy('')
    if (!r.ok) return toast(firstError(r), 'warning')
    toast(`Told ${r.data.emailed + r.data.in_app_only} patient(s)${r.data.in_app_only ? ` (${r.data.in_app_only} in the app only)` : ''}${r.data.already ? `, ${r.data.already} already told` : ''}.`, 'success'); onChanged?.()
  }
  return <div className="st-affected">
    <Notice tone="warning" title={`${rows.length} booked appointment(s) affected`}>Nothing was cancelled. Move each one to another dentist, or email the patients a link to choose a new time.</Notice>
    <ul className="fd-list">{rows.map(a => <li key={a.id}>
      <div><b>{longDate(a.date)} · {a.time} · {a.patient}</b><span>{a.service} · {a.branch}{a.notified ? ' · patient told' : ''}</span>
        {!a.cover.length && <span>No other dentist is free at that time.</span>}</div>
      {canAct && <div className="ns-actions">{a.cover.slice(0, 2).map(d => <Button key={d.id} size="sm" variant="soft" disabled={!!busy} onClick={() => move(a, d)}>{busy === a.id + d.id ? 'Moving…' : `Move to ${d.name}`}</Button>)}</div>}
    </li>)}</ul>
    {canAct && <div className="au-actions"><Button size="sm" icon="mail" disabled={!!busy || wordingApproved === false} onClick={notify}
      title={wordingApproved === false ? 'The Owner must approve the “Dentist unavailable” email wording first' : undefined}>{busy === 'notify' ? 'Sending…' : 'Email them a reschedule link'}</Button>
      {wordingApproved === false && <span className="au-muted">The Owner must approve the “Dentist unavailable” wording first (Automations → wording).</span>}</div>}
  </div>
}

// ---- M3 Work schedules ----------------------------------------------------------------------------------------------

export function WorkSchedulesPage({ store, role }) {
  const allowed = !!store?.session?.serverUserId && store.session.role === role &&
    (!store.getAuthGeneration || store.getAuthGeneration() != null) && Array.isArray(store.state?.users) && Array.isArray(store.state?.persons) && canAccessPage(store.state, store.session, 'schedules')
  if (!allowed) return <Notice title="Work schedules unavailable">Your current account cannot open work schedules. Refresh your session and try again.</Notice>
  return <WorkScheduleSession key={JSON.stringify([role, schedulingActorKey(store)])} store={store} role={role}/>
}

function WorkScheduleSession({ store, role }) {
  const toast = store?.toast || (() => {})
  const [data, setData] = useState(null), [error, setError] = useState(''), [selected, setSelected] = useState(''), [affected, setAffected] = useState(null), [approved, setApproved] = useState(true), [scheduleRole, setScheduleRole] = useState('dentist')
  const [loading, setLoading] = useState(true)
  const live = useRef(false), generation = useRef(0), affectedGeneration = useRef(0), selectedRef = useRef(selected)
  const dentistControl = useRef(null)
  const auth = store.getAuthGeneration?.()
  selectedRef.current = selected
  const owner = useRequestOwner(selected, store.getAuthGeneration)
  const load = async () => {
    const request = ++generation.current, auth = store.getAuthGeneration?.()
    setLoading(true)
    try {
      const r = await workSchedules()
      if (!live.current || request !== generation.current || auth !== store.getAuthGeneration?.()) return
      if (!r.ok || !Array.isArray(r.data?.dentists) || !Array.isArray(r.data?.branches) || !Array.isArray(r.data?.exceptions) || !r.data?.weekdays) {
        setError(r.message || 'Work schedules could not be loaded.'); return
      }
      setData(r.data); setError(''); setApproved(r.data.wording_approved)
      const ownDentist = role === 'dentist' ? (r.data.dentists.find(d => d.id === store?.session?.dentistId || d.userId === store?.session?.userId)) : null
      setSelected(s => r.data.dentists.some(d => d.id === s) ? s : ownDentist?.id || r.data.dentists[0]?.id || '')
    } catch { if (live.current && request === generation.current) setError('Work schedules could not be loaded. Try again.') }
    finally { if (live.current && request === generation.current) setLoading(false) }
  }
  React.useLayoutEffect(() => { live.current = true; load(); return () => { live.current = false; generation.current++; affectedGeneration.current++ } }, [])
  const dentist = data?.dentists.find(d => d.id === selected)
  const dutyBranches = role === 'staff'
    ? (dentist?.branches || []).filter(branch => data?.duty?.rows?.some(row => row.dentist_id === dentist.id && row.branch_id === branch.id))
    : (dentist?.branches || [])
  const refreshAffected = async () => {
    if (!dentist) return
    const id = dentist.id, request = ++affectedGeneration.current, auth = store.getAuthGeneration?.()
    try {
      const r = await scheduleAffected(id)
      if (live.current && request === affectedGeneration.current && selectedRef.current === id && auth === store.getAuthGeneration?.() && r.ok) { setAffected(r.data.affected); setApproved(r.data.wording_approved) }
    } catch { /* The affected list remains unavailable; no care action is inferred. */ }
  }
  useEffect(() => { setAffected(null); refreshAffected(); return () => { affectedGeneration.current++ } }, [selected])
  const after = r => { if (!live.current || selectedRef.current !== dentist?.id || auth !== store.getAuthGeneration?.()) return; affectedGeneration.current++; if (r.data?.affected) setAffected(r.data.affected); load() }
  const currentToast = (...args) => { if (live.current && selectedRef.current === dentist?.id && auth === store.getAuthGeneration?.()) toast(...args) }
  const editable = dentist?.branches.some(b => b.editable)
  const canEdit = role === 'owner' && editable && !error
  const staffSessionKey = JSON.stringify([store?.session?.serverUserId, store?.session?.userId, store?.session?.role, store?.session?.active, store?.session?.branchScopes])

  return <div className="st-page">
    <PageHeader kicker={role === 'dentist' ? 'My hours' : role === 'owner' ? 'Administration' : 'Team'} title={role === 'dentist' ? 'My work hours' : 'Work schedules'}
      text="Each dentist’s weekly hours per branch, and dated exceptions. Online booking, the front desk, walk-ins and the calendar use only these hours, inside the branch’s opening hours and minus approved leave. A change never cancels an appointment."/>
    {role === 'staff' && <Notice tone="info" title="Staff shift profiles are read-only">Only the Clinic Owner can change Staff shift profiles. A profile's hours do not confirm weekday coverage. Request time off under Leave.</Notice>}
    {error && <div role="alert"><Notice tone="warning" title="Unavailable">{error} {data && 'Showing the last loaded schedule.'} <Button variant="ghost" disabled={loading} onClick={load}>Retry work schedules</Button></Notice></div>}
    {role !== 'dentist' && (
      <div className="st-role-toggle" role="tablist" aria-label="Schedule role selector" style={{display:'flex',gap:'8px',marginBottom:'12px'}}>
        <Button variant={scheduleRole === 'dentist' ? 'primary' : 'soft'} size="sm" onClick={() => setScheduleRole('dentist')} role="tab" aria-selected={scheduleRole === 'dentist'}>Dentist schedules</Button>
        <Button variant={scheduleRole === 'staff' ? 'primary' : 'soft'} size="sm" onClick={() => setScheduleRole('staff')} role="tab" aria-selected={scheduleRole === 'staff'}>Staff schedules</Button>
      </div>
    )}
    {scheduleRole === 'staff' && role !== 'dentist' ? (
      <StaffScheduleProfiles key={staffSessionKey} role={role} session={store?.session}/>
    ) : (
      !data ? (loading && <p className="au-muted" role="status">Loading work schedules…</p>) : !data.dentists.length ? <Notice>No dentists to show for your branches.</Notice> : <>
        {loading && <p role="status">Refreshing work schedules…</p>}
        <Card>
          {role === 'dentist' ? (<div className="dentist-hours-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap',paddingBottom:'10px',borderBottom:'1px solid var(--line)'}}><div><span className="block-muted" style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700}}>Rostered Provider</span><b style={{fontSize:'16px',color:'var(--ink)',display:'block',marginTop:'2px'}}>{dentist?.name || store?.session?.name || 'Dentist'}</b></div>{data.dentists.length > 1 && (<label style={{fontSize:'12px',display:'flex',alignItems:'center',gap:'6px'}}><span className="au-muted">Select dentist:</span><select value={selected} onChange={e => setSelected(e.target.value)} style={{width:'auto',minHeight:'36px',padding:'4px 8px'}}>{data.dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>)}</div>) : (<Field label="Dentist"><select value={selected} ref={dentistControl} onChange={e => setSelected(e.target.value)}>{data.dentists.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>)}
          {dentist && <div className="den12-duty" role="status" aria-label="Dentist duty today by branch"><p className="den12-duty-title">Duty today by branch</p><div className="den12-duty-list">{dutyBranches.map(branch => {
            const status = dutyForBranch(data.duty, dentist.id, branch.id, manilaToday())
            return <div className="den12-duty-item" key={branch.id}><strong>{branch.name}</strong><span className={`fd-badge ${status === 'on' ? 'is-ok' : status === 'off' ? 'is-muted' : 'is-unknown'}`}>{status === 'on' ? 'On duty today' : status === 'off' ? 'Off duty' : 'Duty status unavailable'}</span></div>
          })}{!dutyBranches.length && <span className="fd-badge is-unknown">Duty status unavailable</span>}</div></div>}
          {role === 'dentist' && <Notice tone="info" title="Roster and working hours are managed by the Clinic Owner and Front Desk staff">Dentists view rostered schedules and shift hours read-only. To request time off or coverage, submit a request under Leave.</Notice>}
          {dentist?.demo && <Notice tone="info" title="Demo schedule, not confirmed by the clinic">These hours were made up for the demonstration. The clinic still has to give each dentist’s real hours.</Notice>}
          {dentist?.profile_hours && <Notice tone="info" title="No weekly schedule yet">Booking uses the hours on the profile ({t12(dentist.profile_hours.start)}–{t12(dentist.profile_hours.end)}) on every day the branch is open, and the calendar marks its capacity as estimated.
            {owner.busy && <p role="status">Copying profile hours…</p>}
            {canEdit && <div className="ns-actions st-gap">{dentist.branches.filter(b => b.editable).map(b => <Button key={b.id} size="sm" variant="soft" disabled={owner.busy} onClick={async () => {
              const ticket = owner.begin(); if (!ticket) return
              try {
                const r = await copyProfileHours(dentist.id, b.id)
                if (!owner.current(ticket)) return
                if (!r.ok) return toast(firstError(r), 'warning')
                toast(`${r.data.created} day(s) added at ${b.name}. Edit any day below.`, 'success'); dentistControl.current?.focus(); after(r)
              } catch { if (owner.current(ticket)) setError('Could not confirm the schedule copy. Reload before retrying.') }
              finally { owner.finish(ticket) }
            }}>Start from these hours at {b.name}</Button>)}</div>}
            {canEdit && <p className="au-muted">Once a dentist has a weekly schedule, a day without hours is a day off.</p>}</Notice>}
        </Card>
        {dentist && <WeeklyGrid dentist={dentist} data={data} key={`weekly:${dentist.id}`} toast={currentToast} onSaved={after} canEdit={canEdit} role={role} getAuthGeneration={store.getAuthGeneration}/>}
        {dentist && <Card title="Affected appointments" subtitle="The next 90 days: booked times this dentist no longer covers.">
          <AffectedAppointments rows={affected} key={dentist.id} wordingApproved={approved} toast={currentToast} canAct={role !== 'dentist'} onChanged={() => { if (live.current && selectedRef.current === dentist.id && auth === store.getAuthGeneration?.()) refreshAffected() }}
            onNotify={() => notifyScheduleAffected(dentist.id)}/>
        </Card>}
        <Exceptions data={data} dentist={dentist} key={`exceptions:${dentist?.id || 'none'}`} toast={currentToast} onSaved={after} canEdit={canEdit} getAuthGeneration={store.getAuthGeneration}/>
      </>
    )}
  </div>
}

export function staffScheduleProfiles(data, session, role) {
  if (!session?.serverUserId || !session.active || session.role !== role || !['owner', 'staff'].includes(role)) return []
  const rows = Array.isArray(data?.staff) ? data.staff : []
  if (role === 'owner') return rows
  const scopes = Array.isArray(session.branchScopes) ? session.branchScopes : []
  return rows.filter(row => row.branch?.id && scopes.includes(row.branch.id))
}

export function staffShiftSummary(row) {
  const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) ? value.slice(0, 5) : ''
  return { id: row.id, name: row.name || 'Staff member', title: row.title || 'Staff',
    branch: typeof row.branch === 'object' ? row.branch?.name || 'No branch recorded' : row.branch || 'No branch recorded',
    branchRef: typeof row.branch === 'object' ? row.branch?.id || '' : row.branchId || '',
    start: time(row.shift_start ?? row.shiftStart), end: time(row.shift_end ?? row.shiftEnd),
    available: typeof row.available === 'boolean' ? row.available : null }
}

const useStaffLayoutEffect = typeof window === 'undefined' ? useEffect : React.useLayoutEffect

export function StaffScheduleProfiles({ role, session }) {
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [selected, setSelected] = useState(''), [saving, setSaving] = useState(false)
  const live = useRef(false), generation = useRef(0)
  const authorized = !!session?.serverUserId && session.active && session.role === role && ['owner', 'staff'].includes(role)
  const load = async () => {
    if (!live.current || !authorized) return
    const request = ++generation.current
    try {
      const result = await workSchedules()
      if (!live.current || generation.current !== request) return
      if (!result.ok || !Array.isArray(result.data?.staff)) {
        if (['unauthenticated', 'forbidden'].includes(result.kind)) setSnapshot(null)
        setError(result.message || 'Staff shift profiles could not be loaded.'); return
      }
      setSnapshot(result.data); setError('')
    } catch { if (live.current && generation.current === request) setError('Staff shift profiles could not be loaded.') }
  }
  useStaffLayoutEffect(() => { live.current = true; load(); return () => { live.current = false; generation.current++ } }, [])
  const staff = staffScheduleProfiles(snapshot, session, role)
  const current = staff.find(s => s.id === selected) || staff[0]
  const summary = current ? staffShiftSummary(current) : null
  if (!authorized) return <Notice title="Clinic server required">Staff shift profiles require an active Staff or Owner server session. Historical workspace profiles are not shown as live schedules.</Notice>
  return <Card title="Staff shift profiles" subtitle="Profile hours and assignment; weekday coverage is not provided.">
    {error && <div role="alert" tabIndex={0}><p>{error} {snapshot && 'Showing the last loaded profiles.'}</p><Button variant="ghost" onClick={load}>Retry staff profiles</Button></div>}
    {!snapshot ? !error && <p role="status">Loading Staff profiles…</p> : !staff.length ? <p>No Staff shift profiles are available in your branch scope.</p> : <>
      <Field label="Staff member"><select value={summary.id} disabled={saving} onChange={e => setSelected(e.target.value)}>{staff.map(s => <option key={s.id} value={s.id}>{s.name || 'Staff member'} · {s.branch?.name || 'No branch recorded'}</option>)}</select></Field>
      <StaffShiftProfile key={summary.id} staff={summary} role={role} branches={snapshot.branches || []} canEdit={role === 'owner' && !error}
        onPending={setSaving} onSaved={record => {
          // Adopt only this profile's authoritative response, never the currently selected row.
          generation.current++
          setSnapshot(previous => ({ ...previous, staff: previous.staff.map(row => row.id === record.id ? { ...row, branch: record.branchId ? { id: record.branchId, name: record.branch } : null, shift_start: record.shiftStart, shift_end: record.shiftEnd, available: record.available } : row) }))
        }}/>
    </>}
  </Card>
}

export function StaffShiftProfile({ staff, role, branches, canEdit, onPending = () => {}, onSaved = () => {} }) {
  const [editing, setEditing] = useState(false), [start, setStart] = useState(staff.start), [end, setEnd] = useState(staff.end), [branch, setBranch] = useState(staff.branchRef)
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const live = useRef(false), pending = useRef(false), allowed = useRef(false), controls = useRef(null), restoreFocus = useRef(false)
  allowed.current = role === 'owner' && canEdit
  useStaffLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useStaffLayoutEffect(() => { if (restoreFocus.current && !editing) { controls.current?.querySelector('button')?.focus(); restoreFocus.current = false } }, [editing])
  const save = async event => {
    event.preventDefault()
    if (!allowed.current || !live.current || pending.current) return
    const id = staff.id, payload = { shift_start: start, shift_end: end }
    // Presence of branch_ref instructs the server to synchronize authorization scopes.
    if (branch && branch !== staff.branchRef) payload.branch_ref = branch
    pending.current = true; setSaving(true); onPending(true); setError(''); setSuccess('')
    try {
      const result = await updateStaffProfile(id, payload)
      if (!live.current || !allowed.current) return
      if (!result.ok) { setError(firstError(result)); return }
      if (result.data?.id !== id) { setError('The saved profile could not be confirmed. Close and reopen Staff schedules to reload.'); return }
      onSaved(result.data)
      restoreFocus.current = true; setEditing(false); setSuccess(`Shift profile saved for ${staff.name}. Weekly coverage remains unavailable.`)
    } catch { if (live.current && allowed.current) setError('Could not save this shift profile. Your changes are still in the form.') }
    finally { pending.current = false; if (live.current) { setSaving(false); onPending(false) } }
  }
  return <div className="st-gap">
    <h3>{staff.name}</h3><p className="au-muted">{staff.title}</p>
    <dl><dt>Assigned branch</dt><dd>{staff.branch}</dd><dt>Shift hours returned by the server</dt><dd>{staff.start && staff.end ? `${t12(staff.start)}–${t12(staff.end)}` : 'Shift hours unavailable'}</dd>
      <dt>Profile availability</dt><dd>{staff.available === true ? 'Marked available' : staff.available === false ? 'Marked unavailable' : 'Availability not provided'}</dd></dl>
    <p>The schedule response may substitute 09:00–18:00 when stored shift hours are missing. It does not identify which values are defaults. These hours do not confirm attendance or coverage.</p>
    <Notice title="Weekly Staff roster unavailable">No per-weekday Staff duty roster is provided. Working days, days off and weekly coverage cannot be determined from this shift interval.</Notice>
    {success && <p role="status">{success}</p>}
    {error && <p id="staff-shift-error" role="alert" tabIndex={0}>{error}</p>}
    {role === 'owner' && canEdit && <div ref={controls}><Button variant="soft" onClick={() => {
      setStart(staff.start); setEnd(staff.end); setBranch(staff.branchRef); setError(''); setSuccess(''); setEditing(true)
    }} disabled={saving || editing}>Change shift profile</Button></div>}
    {role === 'owner' && canEdit && editing && <form onSubmit={save} className="au-form" aria-label={`Edit shift for ${staff.name}`} aria-describedby={error ? 'staff-shift-error' : undefined} aria-busy={saving}>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="st-pair"><Field label="Shift start"><input autoFocus type="time" value={start} onChange={e => setStart(e.target.value)} required/></Field><Field label="Shift end"><input type="time" value={end} onChange={e => setEnd(e.target.value)} required/></Field></div>
        <Field label="Assigned branch"><select value={branch} onChange={e => setBranch(e.target.value)}>
          <option value="" disabled>No assigned branch</option>
          {staff.branchRef && !branches.some(b => b.id === staff.branchRef) && <option value={staff.branchRef}>{staff.branch}</option>}
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></Field>
        <div className="ns-actions"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save shift profile'}</Button><Button variant="ghost" onClick={() => { restoreFocus.current = true; setEditing(false); setError('') }}>Cancel</Button></div>
      </fieldset>
    </form>}
  </div>
}

function WeeklyGrid({ dentist, data, toast, onSaved, canEdit = true, role = 'owner', getAuthGeneration }) {
  const [editing, setEditing] = useState(null)
  const owner = useRequestOwner(JSON.stringify([dentist.id, editing, canEdit]), getAuthGeneration)
  const controls = useRef(null), restore = useRef(null)
  React.useLayoutEffect(() => { if (!editing && restore.current) { [...(controls.current?.querySelectorAll('button[data-hours-key]') || [])].find(button => button.dataset.hoursKey === restore.current)?.focus(); restore.current = null } }, [editing])
  const rowFor = (branch, day) => dentist.weekly.find(w => w.branch.id === branch.id && w.weekday === Number(day))
  const hours = (branchId, day) => data.branches.find(b => b.id === branchId)?.hours?.[day]
  return <Card className="den12-roster" title={role === 'dentist' ? 'My rostered weekly hours' : 'Weekly hours'} subtitle={canEdit ? 'Select Change to edit a day. The hours must fall inside the branch’s opening hours.' : 'Scheduled shift hours by branch for each day of the week (read-only).'}>
    <ul className="st-week" ref={controls}>{Object.entries(data.weekdays).sort(([a], [b]) => Number(a) - Number(b)).map(([day, name]) => <li key={day}>
      <b className="st-day">{name}</b>
      <div className="st-cells">{dentist.branches.map(b => {
        const row = rowFor(b, day), open = hours(b.id, day), key = `${b.id}:${day}`
        const label = !open ? 'Branch closed' : row ? `${t12(row.start)}–${t12(row.end)}${row.break_start ? ` · break ${t12(row.break_start)}–${t12(row.break_end)}` : ''}` : dentist.profile_hours ? `Estimated profile hours: ${t12(dentist.profile_hours.start)}–${t12(dentist.profile_hours.end)}` : 'Day off'
        return <div key={b.id} className={`st-cell ${row && open ? 'is-on' : ''}`}>
          <span className="st-branch">{b.name}</span>
          {editing === key && canEdit ? <HoursForm row={row} open={open} onCancel={() => { restore.current = key; setEditing(null) }} onSave={async (body, remove) => {
            const ticket = owner.begin(); if (!ticket) return null
            try {
              const r = await saveWeeklyHours(dentist.id, remove ? { branch_ref: b.id, weekday: Number(day), remove: true } : { branch_ref: b.id, weekday: Number(day), ...body })
              if (!owner.current(ticket)) return null
              if (!r.ok) return firstError(r)
              restore.current = key; setEditing(null); toast(remove ? `${name} removed: a day off at ${b.name}.` : `${name} saved.`, 'success'); onSaved(r); return null
            } catch { return owner.current(ticket) ? 'Could not confirm the save. Your hours are retained. Reload before retrying.' : null }
            finally { owner.finish(ticket) }
          }}/> : <>
            <span>{label}</span>
            {canEdit && b.editable && open && <Button size="sm" variant="ghost" data-hours-key={key} onClick={() => setEditing(key)} aria-label={`Change ${name} at ${b.name}`}>Change</Button>}
          </>}
        </div>
      })}</div>
    </li>)}</ul>
  </Card>
}

function HoursForm({ row, open, onSave, onCancel }) {
  const [f, setF] = useState({ start_time: row?.start || open?.open || '09:00', end_time: row?.end || open?.close || '17:00', has_break: !!row?.break_start, break_start: row?.break_start || '12:00', break_end: row?.break_end || '13:00' })
  const [err, setErr] = useState('')
  const owner = useRequestOwner('hours'), busy = owner.busy
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const save = async remove => {
    const ticket = owner.begin(); if (!ticket) return
    setErr('')
    try {
      const e = await onSave({ start_time: f.start_time, end_time: f.end_time, break_start: f.has_break ? f.break_start : null, break_end: f.has_break ? f.break_end : null }, remove)
      if (owner.current(ticket) && e) setErr(e)
    } catch { if (owner.current(ticket)) setErr('Could not confirm the save. Your hours are retained. Reload before retrying.') }
    finally { owner.finish(ticket) }
  }
  return <form className="au-form st-hours" aria-label="Edit weekly hours" aria-busy={busy} onSubmit={e => { e.preventDefault(); save(false) }}>
    {busy && <p role="status">Saving weekly hours…</p>}
    <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
    {open && <p className="au-muted">Branch open {t12(open.open)}–{t12(open.close)}</p>}
    <div className="st-pair"><Field label="Starts"><input type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)}/></Field>
      <Field label="Ends"><input type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)}/></Field></div>
    <label className="au-check"><input type="checkbox" checked={f.has_break} onChange={e => set('has_break', e.target.checked)}/> Break</label>
    {f.has_break && <div className="st-pair"><Field label="Break from"><input type="time" value={f.break_start} onChange={e => set('break_start', e.target.value)}/></Field>
      <Field label="Break to"><input type="time" value={f.break_end} onChange={e => set('break_end', e.target.value)}/></Field></div>}
    {err && <p className="au-error" role="alert">{err}</p>}
    <div className="ns-actions"><Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      {row && <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(true)}>Make it a day off</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button></div>
    </fieldset>
  </form>
}

function Exceptions({ data, dentist, toast, onSaved, canEdit = true, getAuthGeneration }) {
  const editableBranches = dentist?.branches.filter(b => b.editable) || []
  const [f, setF] = useState({ date: '', kind: 'day_off', branch_ref: '', start_time: '09:00', end_time: '12:00', reason: '' })
  const [err, setErr] = useState('')
  const owner = useRequestOwner(JSON.stringify([dentist?.id, canEdit]), getAuthGeneration), busy = owner.busy
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const rows = data.exceptions.filter(e => !dentist || e.dentist.id === dentist.id)
  const add = async e => {
    e.preventDefault()
    if (!canEdit || !dentist) return
    const ticket = owner.begin(); if (!ticket) return
    setErr('')
    try {
      const r = await addScheduleException(dentist.id, { date: f.date, kind: f.kind, reason: f.reason.trim() || null, ...(f.kind === 'custom_hours' ? { branch_ref: f.branch_ref || editableBranches[0]?.id, start_time: f.start_time, end_time: f.end_time } : {}) })
      if (!owner.current(ticket)) return
      if (!r.ok) return setErr(firstError(r))
      toast('Exception saved. Booking reflects it now.', 'success'); setF(x => ({ ...x, date: '', reason: '' })); onSaved(r)
    } catch { if (owner.current(ticket)) setErr('Could not confirm the save. Your exception is retained. Reload before retrying.') }
    finally { owner.finish(ticket) }
  }
  const remove = async id => {
    if (!canEdit) return
    const ticket = owner.begin(); if (!ticket) return
    setErr('')
    try {
      const r = await removeScheduleException(id)
      if (!owner.current(ticket)) return
      if (!r.ok) return setErr(firstError(r))
      toast('Exception removed.', 'success'); onSaved(r)
    } catch { if (owner.current(ticket)) setErr('Could not confirm the change. Reload the exceptions before retrying.') }
    finally { owner.finish(ticket) }
  }
  return <Card title="Exceptions" subtitle="One date: a day off (every branch) or different hours at one branch.">
    {busy && <p role="status">Saving schedule exception…</p>}
    {err && <p className="au-error" role="alert">{err}</p>}
    {!rows.length ? <p className="au-muted">No upcoming exceptions{dentist ? ` for ${dentist.name}` : ''}.</p> : <ul className="fd-list">{rows.map(x => <li key={x.id}>
      <div><b>{longDate(x.date)} · {x.kind === 'day_off' ? 'Day off' : `${t12(x.start)}–${t12(x.end)} at ${x.branch?.name}`}</b><span>{x.dentist.name}{x.reason ? ` · ${x.reason}` : ''}</span></div>
      {canEdit && x.editable && <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(x.id)}>Remove</Button>}
    </li>)}</ul>}
    {canEdit && dentist && editableBranches.length > 0 && <form className="au-form st-exception" aria-label={`Add exception for ${dentist.name}`} aria-busy={busy} onSubmit={add}>
      <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <h3 className="st-sub">Add an exception for {dentist.name}</h3>
      <Field label="Date" required><input type="date" min={manilaToday()} value={f.date} onChange={e => set('date', e.target.value)} required/></Field>
      <Field label="Kind"><select value={f.kind} onChange={e => set('kind', e.target.value)}><option value="day_off">Day off</option><option value="custom_hours">Different hours</option></select></Field>
      {f.kind === 'custom_hours' && <>
        <Field label="Branch"><select value={f.branch_ref || editableBranches[0]?.id} onChange={e => set('branch_ref', e.target.value)}>{editableBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <div className="st-pair"><Field label="Starts"><input type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)}/></Field>
          <Field label="Ends"><input type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)}/></Field></div>
      </>}
      <Field label="Reason (internal)" hint="Optional, for example “Seminar”."><input value={f.reason} maxLength={120} onChange={e => set('reason', e.target.value)}/></Field>
      <div className="au-actions"><Button type="submit" disabled={busy || !f.date}>{busy ? 'Saving…' : 'Add exception'}</Button></div>
      </fieldset>
    </form>}
  </Card>
}

// ---- M15 Leave ------------------------------------------------------------------------------------------------------

const STATUS_TONE = { Pending: 'is-late', Approved: 'is-ok', Declined: 'is-bad', Cancelled: '' }

export function LeavePage({ store, role }) {
  const toast = store?.toast || (() => {})
  const requester = role === 'staff' || role === 'dentist'
  const [tick, setTick] = useState(0), changed = () => setTick(t => t + 1)
  return <div className="st-page">
    <PageHeader kicker={role === 'owner' ? 'Administration' : 'Team'} title={role === 'owner' ? 'Leave requests' : 'Leave'}
      text="Vacation, sick and other leave. Approved leave of a dentist removes their time from booking at once; approving never cancels an appointment. Leave balances are not tracked."/>
    <TeamStrip key={tick}/>
    {requester && <MyLeave toast={toast} onChanged={changed}/>}
    {role !== 'dentist' && <Approvals toast={toast} role={role} onChanged={changed} branches={(store?.state?.branches || []).filter(b => b.status !== 'Closed')}/>}
  </div>
}

function TeamStrip() {
  const from = manilaToday(), to = addDays(from, 13)
  const [rows, setRows] = useState(null)
  useEffect(() => { leaveCalendar(from, to).then(r => setRows(r.ok ? r.data : [])) }, [])
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(from, i)), [from])
  const away = d => (rows || []).filter(r => r.starts_at.slice(0, 10) <= d && (r.ends_at.slice(11, 16) === '00:00' ? addDays(r.ends_at.slice(0, 10), -1) : r.ends_at.slice(0, 10)) >= d)
  return <Card title="Who is away" subtitle="The next two weeks. Approved leave is solid, pending is dashed.">
    {!rows ? <p className="au-muted" role="status">Loading…</p> : <>
      <div className="st-strip" role="list" aria-label="Who is away, next two weeks">{days.map(d => {
        const list = away(d)
        return <div key={d} role="listitem" className="st-strip-day"><b>{longDate(d).replace(/,.*/, '')}<small>{d.slice(8)}</small></b>
          {list.map(r => <span key={r.id} className={`st-away ${r.status === 'Pending' ? 'is-pending' : ''}`} title={`${r.name}: ${r.label} (${r.status})`}>{r.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</span>)}
        </div>
      })}</div>
      {rows.length ? <ul className="st-legend">{rows.map(r => <li key={r.id}><b>{r.name}</b> ({r.role}) · {r.label} · {r.status}</li>)}</ul> : <p className="au-muted">Nobody is away in the next two weeks.</p>}
    </>}
  </Card>
}

function MyLeave({ toast, onChanged }) {
  const [rows, setRows] = useState(null), [denied, setDenied] = useState(false)
  const [f, setF] = useState({ type: 'vacation', start_date: '', end_date: '', partial: false, start_time: '09:00', end_time: '12:00', private_note: '' })
  const [err, setErr] = useState(''), [busy, setBusy] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const load = () => myLeave().then(r => { if (r.ok) { setRows(r.data); onChanged?.() } else if (r.kind === 'forbidden') setDenied(true) })
  useEffect(() => { load() }, [])
  if (denied) return null
  const submit = async e => {
    e.preventDefault(); setErr('')
    if (f.type === 'other' && !f.private_note.trim()) return setErr('Please explain the reason for “Other” leave.')
    if (!f.start_date || f.start_date < manilaToday()) return setErr('Choose today or a later date.')
    const endDate = f.partial ? f.start_date : (f.end_date || f.start_date)
    if (endDate < f.start_date) return setErr('The until date cannot be before the from date.')
    if (f.partial && (!f.start_time || !f.end_time || f.end_time <= f.start_time)) return setErr('The end time must be after the start time.')
    setBusy('add')
    const r = await requestLeave({ type: f.type, start_date: f.start_date, end_date: endDate, private_note: f.private_note.trim() || null, ...(f.partial ? { start_time: f.start_time, end_time: f.end_time } : {}) })
    setBusy('')
    if (!r.ok) return setErr(firstError(r))
    toast('Leave requested. An authorized approver can review it.', 'success')
    setF(x => ({ ...x, start_date: '', end_date: '', private_note: '' })); load()
  }
  return <Card title="My leave">
    <form className="au-form" onSubmit={submit}>
      <Field label="Type"><select value={f.type} onChange={e => set('type', e.target.value)}><option value="vacation">Vacation</option><option value="sick">Sick</option><option value="other">Other</option></select></Field>
      <div className="st-pair"><Field label="From" required><input type="date" min={manilaToday()} value={f.start_date} onChange={e => setF(x => ({ ...x, start_date: e.target.value, end_date: x.end_date && x.end_date < e.target.value ? '' : x.end_date }))} required/></Field>
        <Field label="To (last day)"><input type="date" min={f.start_date || manilaToday()} value={f.partial ? f.start_date : f.end_date} disabled={f.partial} onChange={e => set('end_date', e.target.value)}/></Field></div>
      <label className="au-check"><input type="checkbox" checked={f.partial} onChange={e => set('partial', e.target.checked)}/> Only part of the day</label>
      {f.partial && <div className="st-pair"><Field label="From (time on selected date)"><input type="time" value={f.start_time} onChange={e => set('start_time', e.target.value)}/></Field>
        <Field label="Until (time on selected date)"><input type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)}/></Field></div>}
      <Field label={f.type === 'other' ? 'Specify reason' : 'Private note (optional)'} required={f.type === 'other'} hint="Seen only by you and the approver. Never emailed."><textarea maxLength={500} placeholder={f.type === 'other' ? 'e.g., Family emergency, bereavement, medical appointment' : ''} value={f.private_note} onChange={e => set('private_note', e.target.value)}/></Field>
      {err && <p className="au-error" role="alert">{err}</p>}
      <div className="au-actions"><Button type="submit" disabled={busy === 'add' || !f.start_date || f.start_date < manilaToday() || (!f.partial && f.end_date && f.end_date < f.start_date) || (f.partial && (!f.start_time || !f.end_time || f.end_time <= f.start_time)) || (f.type === 'other' && !f.private_note.trim())}>{busy === 'add' ? 'Sending…' : 'Request leave'}</Button></div>
    </form>
    {!rows ? <p className="au-muted" role="status">Loading…</p> : !rows.length ? <p className="au-muted">No leave requested yet.</p> : <ul className="fd-list">{rows.map(l => <li key={l.id}>
      <div><b>{l.label}</b><span>{l.type_label} · <span className={`fd-badge ${STATUS_TONE[l.status]}`}>{l.status}</span>{l.decided_by ? ` · by ${l.decided_by}` : ''}</span>{l.private_note && <span>Note: {l.private_note}</span>}</div>
      {l.can_cancel && <Button size="sm" variant="ghost" disabled={busy === l.id} onClick={async () => { setBusy(l.id); const r = await cancelLeave(l.id); setBusy(''); if (!r.ok) return toast(firstError(r), 'warning'); toast('Leave cancelled. The time is bookable again.', 'success'); load() }}>Cancel</Button>}
    </li>)}</ul>}
  </Card>
}

function Approvals({ toast, role, branches, onChanged }) {
  const [rows, setRows] = useState(null), [meta, setMeta] = useState({}), [denied, setDenied] = useState(false), [filters, setFilters] = useState({ status: 'Pending', branch_ref: '' })
  const [open, setOpen] = useState(null)
  const load = () => leaveRequests(filters).then(r => { if (r.ok) { setRows(r.data); setMeta(r.meta || {}); onChanged?.() } else if (r.kind === 'forbidden') setDenied(true) })
  useEffect(() => { load() }, [filters.status, filters.branch_ref])
  if (denied) return role === 'staff' ? <Notice tone="info" title="Leave approvals">The Owner approves leave requests. The Owner can let the front desk approve them too (Automations → Work schedules, leave and handovers).</Notice> : null
  return <Card title={role === 'owner' ? 'Leave requests' : 'Leave requests to decide'} subtitle={meta.approver === 'owner_or_front_desk' ? 'Decided by the Owner or the front desk of the requester’s branch.' : 'Decided by the Owner.'}>
    <FilterBar className="st-filters" ariaLabel="Filter leave requests" onClear={(filters.status !== 'Pending' || filters.branch_ref) ? () => setFilters({ status: 'Pending', branch_ref: '' }) : null}>
      <Field label="Status"><select value={filters.status} onChange={e => setFilters(x => ({ ...x, status: e.target.value }))}><option value="">All</option>{['Pending', 'Approved', 'Declined', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Branch"><select value={filters.branch_ref} onChange={e => setFilters(x => ({ ...x, branch_ref: e.target.value }))}><option value="">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
    </FilterBar>
    {!rows ? <p className="au-muted" role="status">Loading…</p> : !rows.length ? <p className="au-muted">No requests here.</p> : <ul className="fd-list">{rows.map(l => <LeaveRow key={l.id} l={l} role={role} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} toast={toast} wordingApproved={meta.wording_approved}
      onChanged={decided => { if (decided && filters.status && decided !== filters.status) { setOpen(l.id); setFilters(x => ({ ...x, status: '' })) } else load() }}/>)}</ul>}
  </Card>
}

function LeaveRow({ l, role, open, onToggle, toast, onChanged, wordingApproved }) {
  const [conflicts, setConflicts] = useState(null), [busy, setBusy] = useState(''), [confirmDecision, setConfirmDecision] = useState(null)
  const loadConflicts = () => l.requester.role === 'Dentist' && leaveConflicts(l.id).then(r => { if (r.ok) setConflicts(r.data.appointments) })
  useEffect(() => { if (open) loadConflicts() }, [open])
  const decide = async decision => {
    setBusy(decision)
    const r = await decideLeave(l.id, decision)
    setBusy('')
    if (!r.ok) return toast(firstError(r), 'warning')
    toast(decision === 'approve' ? `Approved. ${l.requester.role === 'Dentist' ? 'Their booking time is blocked now.' : ''}` : 'Declined.', 'success')
    if (decision === 'approve' && r.data.appointments?.length) setConflicts(r.data.appointments)
    onChanged(r.data.status) // keeps the row (and its affected visits) on screen after the decision
  }
  const doCancel = async () => {
    setBusy('cancel')
    const r = await cancelLeave(l.id)
    setBusy('')
    if (!r.ok) return toast(firstError(r), 'warning')
    toast('Leave cancelled. The time is bookable again.', 'success')
    onChanged()
  }
  return <li className="st-leave">
    <div><b>{l.requester.name} ({l.requester.role}) · {l.label}</b>
      <span>{l.type_label} · <span className={`fd-badge ${STATUS_TONE[l.status]}`}>{l.status}</span>{l.decided_by ? ` · by ${l.decided_by}` : ''}</span>
      {l.private_note && <span>Private note: {l.private_note}</span>}</div>
    <div className="ns-actions">
      {l.can_decide && <><Button size="sm" disabled={!!busy} onClick={() => setConfirmDecision('approve')}>{busy === 'approve' ? 'Accepting…' : 'Accept leave request'}</Button>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setConfirmDecision('decline')}>{busy === 'decline' ? 'Declining…' : 'Decline leave'}</Button></>}
      {l.requester.role === 'Dentist' && l.status !== 'Declined' && l.status !== 'Cancelled' && <Button size="sm" variant="soft" onClick={onToggle} aria-expanded={open}>{open ? 'Hide bookings' : 'Booked appointments'}</Button>}
      {l.can_cancel && l.status === 'Approved' && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setConfirmDecision('cancel')}>Cancel leave</Button>}
    </div>
    {confirmDecision && <ConfirmDialog
      open
      title={confirmDecision === 'approve' ? 'Accept leave request?' : confirmDecision === 'decline' ? 'Decline leave request?' : 'Cancel approved leave?'}
      tone={confirmDecision === 'approve' ? 'default' : 'danger'}
      confirmLabel={confirmDecision === 'approve' ? 'Accept leave request' : confirmDecision === 'decline' ? 'Decline leave' : 'Cancel leave'}
      onConfirm={() => {
        const d = confirmDecision
        setConfirmDecision(null)
        if (d === 'cancel') doCancel()
        else decide(d)
      }}
      onCancel={() => setConfirmDecision(null)}
    >
      <p>
        {confirmDecision === 'approve'
          ? `Accepting this leave request for ${l.requester.name} (${l.label}) blocks new bookings during their away window. Existing appointments remain on the affected list so they can be reassigned or rescheduled.`
          : confirmDecision === 'decline'
            ? `Declining marks this leave request for ${l.requester.name} (${l.label}) as Declined and keeps their schedule open for booking.`
            : `Cancelling this approved leave for ${l.requester.name} (${l.label}) reopens their blocked schedule time for booking.`}
      </p>
    </ConfirmDialog>}
    {open && <div className="st-conflicts">
      {l.status === 'Pending' && conflicts?.length > 0 && <p className="au-muted">Approving keeps these appointments; resolve them before or after approving.</p>}
      <AffectedAppointments rows={conflicts} wordingApproved={wordingApproved} toast={toast} canAct={l.status === 'Approved' || l.status === 'Pending'} onChanged={loadConflicts}
        onNotify={() => l.status === 'Approved' ? notifyLeaveAffected(l.id) : Promise.resolve({ ok: false, message: 'Approve the leave first, then email the patients.' })}/>
    </div>}
  </li>
}
