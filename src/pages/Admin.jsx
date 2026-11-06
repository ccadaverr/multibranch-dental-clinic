import { liveRecords } from '../appointment-projection.js'
import { appointmentWindow } from '../appointments-api.js'
import { pendingHours } from '../phase3-contracts.js'
import { automationSnapshot } from '../orchestration.js'
import React, { useMemo, useRef, useState } from 'react'
import { ROLE_INFO } from '../data.js'
import { eventModuleLabel, ruleTargetLabel } from '../module-map.js'
import { LOYALTY_PROGRAM, canManageLoyalty, ledgerIssue } from '../loyalty.js'
import { Button, Card, ConfirmDialog, Field, FilterBar, Modal, Notice, PageHeader, Progress, StatCard, Status, Table, Tabs } from '../components.jsx'
import { clinicDate } from '../clock.js'
import { branchCapacity, dateLabel, dentistName, makeCsv, patientName, peso, uid } from '../logic.js'
import { syncBranchUpdate, syncBranchServiceToggle, syncPersonnelUpdate } from '../reference-data-bridge.js'
import { createUserAccountRemote, deleteUserAccountRemote, fetchUserAccounts, updateUserAccountRemote } from '../user-management-bridge.js'
import { DEFAULT_COUNTRY, normalizePhoneNumber, sanitizePhoneInput } from '../phone.js'
import { fetchAutomationSnapshot, dispatchAutomationRule, downloadAutomationCsv } from '../automation-api.js'
import { fetchExecutiveSummary, fetchBranchPerformance, downloadAnalyticsCsv } from '../analytics-api.js'
import { sendTestEmail } from '../api-client.js'
import { EmployeeInvitations } from './EmployeeInvitations.jsx'
import { BranchAccessDialog } from './BranchAccessDialog.jsx'
import '../owner-branches.css'
import { OwnerRevenueCharts } from './OwnerRevenueCharts.jsx'

export const ALLOWED_BRANCH_CODES = ['BRC-A', 'BRC-B', 'BRC-C', 'BRC-D', 'BRC-E', 'BRC-F', 'MNL', 'QC', 'MKTI', 'BGC', 'ORT', 'ALB', 'CEB', 'DVO', 'PAS']

// Match UpdateBranchRequest's paired, nullable coordinates and existing branch bounds.
export function branchPinError(latitude, longitude) {
  const empty = value => value == null || String(value).trim() === ''
  if (empty(latitude) && empty(longitude)) return ''
  if (empty(latitude) || !Number.isFinite(Number(latitude)) || Number(latitude) < 4 || Number(latitude) > 22) return 'Enter a latitude from 4 to 22 and a longitude from 114 to 128.'
  if (empty(longitude) || !Number.isFinite(Number(longitude)) || Number(longitude) < 114 || Number(longitude) > 128) return 'Enter a latitude from 4 to 22 and a longitude from 114 to 128.'
  return ''
}

export function BranchMapPicker({ latitude, longitude, onChange }) {
  const mapRef = useRef(null)
  const mapControl = useRef(null)
  const latest = useRef({ latitude, longitude, onChange })
  latest.current = { latitude, longitude, onChange }
  const [mapLoaded, setMapLoaded] = useState(false)
  const [mapError, setMapError] = useState(false)

  React.useEffect(() => {
    let cleanup = null
    let active = true

    if (typeof window !== 'undefined' && mapRef.current) {
      import('../branch-map.js').then(({ mountBranchPinMap }) => {
        if (!active) return
        cleanup = mountBranchPinMap(mapRef.current, {
          ...(branchPinError(latest.current.latitude, latest.current.longitude) ? {} : latest.current),
          onChange: value => latest.current.onChange(value),
        })
        mapControl.current = cleanup
        setMapLoaded(true)
        setMapError(cleanup.ready !== true)
      }).catch(err => {
        if (active) { setMapLoaded(true); setMapError(true) }
      })
    }

    return () => {
      active = false
      if (cleanup) cleanup()
      mapControl.current = null
    }
  }, [])
  React.useEffect(() => {
    // Keep the last valid preview while a coordinate pair is being typed.
    if (!branchPinError(latitude, longitude)) mapControl.current?.setCoordinates?.(latitude, longitude)
  }, [latitude, longitude])

  return (
    <div className="branch-map-picker-container">
      <div
        ref={mapRef}
        className="branch-map-canvas"
        role="region"
        aria-label="Branch location map preview; coordinate controls follow"
        style={{ width: '100%', height: '240px', borderRadius: '8px', border: '1px solid var(--line, #e2e8f0)', background: '#f8fafc', position: 'relative' }}
      >
        {!mapLoaded && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted, #64748b)', fontSize: '13px' }}>
            <span>Loading interactive branch map…</span>
          </div>
        )}
      </div>
      {mapError && <Notice tone="warning">The location map could not load. Reopen the Details tab to retry. You can still edit the coordinates below; Publish Branch Changes saves them.</Notice>}
    </div>
  )
}

export function BranchesPage({ store }) {
  const { state, actions, toast }=store
  const [selected,setSelected]=useState(state.branches[0]?.id||'')
  const branch=state.branches.find(b=>b.id===selected)
  const [form,setForm]=useState(branch||{})
  const [configTab,setConfigTab]=useState('details')
  const coordinateInputRef = useRef(null)
  const coordinateError = branchPinError(form.latitude, form.longitude)
  const coordinateValue = value => value == null || value === '' ? null : Number(value)
  const locationChanged = coordinateValue(form.latitude) !== coordinateValue(branch?.latitude) || coordinateValue(form.longitude) !== coordinateValue(branch?.longitude)
  React.useEffect(()=>setForm(branch||{}),[branch])

  const codesInUse = useMemo(() => new Set(state.branches.filter(b => b.id !== selected).map(b => b.branchCode)), [state.branches, selected])
  const branchCodeOptions = useMemo(() => {
    const list = [...ALLOWED_BRANCH_CODES]
    if (form.branchCode && !list.includes(form.branchCode)) list.unshift(form.branchCode)
    return list
  }, [form.branchCode])

  // Phase 2A: branches/branchServices are backend-authoritative — the API call happens first, and only its
  // confirmed response is adopted into local state (never an optimistic local success ahead of the
  // server). See adoptBranchFromServer/adoptBranchServiceFromServer (administration.js) and the Phase 2A
  // plan, section J/point 8.
  const save=async()=>{
    if (coordinateError) return toast(coordinateError, 'warning')
    if (codesInUse.has(form.branchCode)) {
      return toast(`Branch code ${form.branchCode} is already assigned to another branch.`, 'warning')
    }
    const result=await syncBranchUpdate(selected,form)
    if(!result.ok)return toast(result.message||'Could not save branch changes.','warning')
    const adopted=actions.adoptBranchFromServer(selected,result.record)
    toast(adopted.ok?'Branch configuration saved.':adopted.message,adopted.ok?'success':'warning')
  }
  const serviceActive=serviceId=>state.branchServices.some(bs=>bs.branchId===selected&&bs.serviceId===serviceId&&bs.active!==false)
  const toggleService=async serviceId=>{
    const result=await syncBranchServiceToggle(selected,serviceId,!serviceActive(serviceId))
    if(!result.ok)return toast(result.message||'Could not update service availability.','warning')
    const adopted=actions.adoptBranchServiceFromServer(selected,serviceId,result.record)
    if(!adopted.ok)toast(adopted.message,'warning')
  }
  const activeServicesCount=state.services.filter(s=>s.status==='Active'&&serviceActive(s.id)).length
  const configTabs=[
    {key:'details',label:'Details & Contact'},
    {key:'hours',label:'Opening Hours'},
    {key:'services',label:`Services (${activeServicesCount})`},
  ]
  return <div className="owner-branches">
    <PageHeader title="Multi-Branch Clinic Management" text="Clinic locations and operational branch information."/>
    <Notice tone="warning">Branch names, addresses, phones, emails and opening hours were given by the clinic (October 2026). Capacity settings still need clinic confirmation, and holiday or temporary-closure schedules have not been supplied.</Notice>
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 10px', color: 'var(--text)' }}>Clinic Branches Overview</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
        {state.branches.map(b => {
          const isSel = selected === b.id;
          const activeSvcCount = state.services.filter(s => s.status === 'Active' && state.branchServices.some(bs => bs.branchId === b.id && bs.serviceId === s.id && bs.active !== false)).length;
          return (
            <div
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={`branch-overview-card ${isSel ? 'branch-card-selected' : ''}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <b style={{ fontSize: '15px', color: 'var(--text)' }}>{b.name}</b>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                    <span className="branch-code-badge">{b.branchCode}</span>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>• {b.city}</span>
                  </div>
                </div>
                <Status tone={b.status === 'Open' ? 'success' : b.status === 'Temporarily Closed' ? 'warning' : 'neutral'}>{b.status}</Status>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
                <span>Services: <b>{activeSvcCount}</b></span>
                <span>Phone: <b>{b.phone || '—'}</b></span>
              </div>
              <div style={{ marginTop: '10px', textAlign: 'right' }}>
                <Button size="sm" variant={isSel ? 'primary' : 'soft'} aria-pressed={isSel} onClick={(e) => { e.stopPropagation(); setSelected(b.id); }}>{isSel ? 'Configuring' : 'Configure'}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    <div className="admin-config">
      {branch&&<Card title={`Configure ${branch.name}`} subtitle={`${branch.branchCode} • ${branch.city}`}>
        <Tabs tabs={configTabs} active={configTab} onChange={setConfigTab}/>
        {configTab==='details'&&<div className="form-grid" style={{marginTop:'12px'}}>
          <Field label="Branch name"><input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
          <Field label="Branch code" hint="Select an allowed clinic branch code. Codes assigned to other branches are blocked.">
            <select
              value={form.branchCode || ''}
              aria-label="Branch code"
              onChange={e => {
                const code = e.target.value
                if (codesInUse.has(code)) {
                  toast(`Branch code ${code} is already assigned to another branch.`, 'warning')
                  return
                }
                setForm({ ...form, branchCode: code })
              }}
            >
              <option value="" disabled>Select branch code…</option>
              {branchCodeOptions.map(code => {
                const inUse = codesInUse.has(code)
                return (
                  <option key={code} value={code} disabled={inUse}>
                    {code}{inUse ? ' (In use)' : ''}
                  </option>
                )
              })}
            </select>
          </Field>
          <Field label="City"><input value={form.city||''} onChange={e=>setForm({...form,city:e.target.value})}/></Field>
          <Field label="Branch status"><select value={form.status||'Open'} aria-label="Branch status" onChange={e=>setForm({...form,status:e.target.value})}><option>Open</option><option>Temporarily Closed</option><option>Inactive</option></select></Field>
          <Field label="Capacity threshold (unconfirmed)"><input type="number" min="1" max="100" value={form.threshold??''} onChange={e=>setForm({...form,threshold:Number(e.target.value)})}/></Field>
          <Field label="Phone"><input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
          <Field label="Email (optional)"><input type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})}/></Field>
          <Field label="Address"><textarea value={form.address||''} onChange={e=>setForm({...form,address:e.target.value})}/></Field>
          <div className="branch-map-field" style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
            <p className="field-label">Branch location map <small>Click the map, drag the pin, or enter coordinates below.</small></p>
            <BranchMapPicker
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={({ latitude, longitude }) => setForm(f => ({ ...f, latitude, longitude }))}
            />
            <fieldset className="branch-coordinate-editor" aria-describedby="branch-coordinate-help">
              <legend>Draft pin coordinates</legend>
              <p id="branch-coordinate-help">Enter the branch’s known coordinates using the keyboard. Tab moves between controls. Valid pairs update the preview; edits are saved only with Publish Branch Changes.</p>
              <div className="form-grid">
                <Field label="Draft latitude" hint="4 to 22 degrees">
                  <input ref={coordinateInputRef} type="number" min="4" max="22" step="any" value={form.latitude ?? ''}
                    aria-invalid={!!coordinateError} aria-describedby="branch-coordinate-help branch-coordinate-status"
                    onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}/>
                </Field>
                <Field label="Draft longitude" hint="114 to 128 degrees">
                  <input type="number" min="114" max="128" step="any" value={form.longitude ?? ''}
                    aria-invalid={!!coordinateError} aria-describedby="branch-coordinate-help branch-coordinate-status"
                    onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}/>
                </Field>
              </div>
              <Button variant="ghost" disabled={!locationChanged} onClick={() => {
                setForm(f => ({ ...f, latitude: branch.latitude, longitude: branch.longitude }))
                coordinateInputRef.current?.focus()
              }}>Reset location to saved coordinates</Button>
            </fieldset>
            <p id="branch-coordinate-status" role={coordinateError ? 'alert' : 'status'}>
              {coordinateError || (locationChanged ? 'Unsaved location changes. Publish Branch Changes to save.' : 'Location matches the saved branch record.')}
            </p>
            <div className="branch-coords-readout">
              <span>Latitude: <b className="coord-value">{form.latitude != null && form.latitude !== '' ? Number(form.latitude).toFixed(6) : 'Not pinned'}</b></span>
              <span>Longitude: <b className="coord-value">{form.longitude != null && form.longitude !== '' ? Number(form.longitude).toFixed(6) : 'Not pinned'}</b></span>
              <small style={{ color: 'var(--muted)' }}>The pin updates this form. Select Publish Branch Changes to save.{branch.latitude == null || branch.longitude == null ? ' This branch has no saved location; the starting map view is not a branch location.' : ''}</small>
            </div>
          </div>
        </div>}
        {configTab==='hours'&&<div style={{marginTop:'12px'}}>
          <label className="field-label">Opening hours <small>Per day; a closed day cannot be booked and is greyed out in the booking calendar</small></label>
          <div className="hours-editor">{[[1,'Monday'],[2,'Tuesday'],[3,'Wednesday'],[4,'Thursday'],[5,'Friday'],[6,'Saturday'],[7,'Sunday']].map(([day,label])=>{const week=form.weeklyHours||{};const h=week[day]||week[String(day)]||null;const setDay=value=>setForm({...form,weeklyHours:{...week,[day]:value}});const openDays=Object.values(week).filter(Boolean).length;return <div key={day} className="hours-row">
            <span className="hours-day">{label}</span>
            <div className="hours-closed-action">
              <Button
                type="button"
                size="xs"
                variant={!h ? 'danger' : 'soft'}
                className={`btn-toggle-closed ${!h ? 'is-closed' : 'is-open'}`}
                disabled={h && openDays === 1}
                aria-label={`${label}: ${!h ? 'Closed' : 'Open'}`}
                aria-pressed={!h}
                onClick={() => setDay(h ? null : { open: form.open || '08:00', close: form.close || '17:00' })}
                title={h && openDays === 1 ? 'At least one operating day must remain open' : !h ? 'Day is closed. Click to mark open.' : 'Day is open. Click to mark closed.'}
              >
                {!h ? 'Closed' : 'Open'}
              </Button>
            </div>
            {h&&<><label><span className="sr-only">{label} opens</span><input type="time" value={h.open} onChange={e=>setDay({...h,open:e.target.value})}/></label><span aria-hidden="true">to</span><label><span className="sr-only">{label} closes</span><input type="time" value={h.close} onChange={e=>setDay({...h,close:e.target.value})}/></label></>}
          </div>})}</div>
        </div>}
        {configTab==='services'&&<div style={{marginTop:'12px'}}>
          <label className="field-label">Available services <small>Branch services • scheduling reads this catalog directly</small></label>
          <div className="branch-services-grid">{state.services.filter(s=>s.status==='Active').map(service=>{const active=serviceActive(service.id);return <label className={`branch-service-item ${active?'is-active':''}`} key={service.id}><input type="checkbox" checked={active} onChange={()=>toggleService(service.id)}/><div><b>{service.name}</b><small style={{display:'block',color:'var(--muted)'}}>{service.category} • {service.duration} min</small></div></label>})}</div>
        </div>}
        {configTab !== 'details' && <p id="branch-coordinate-status" role={coordinateError ? 'alert' : 'status'}>{coordinateError || (locationChanged ? 'Unsaved location changes. Publish Branch Changes to save.' : 'Location matches the saved branch record.')}</p>}
        <div style={{marginTop:'16px',display:'flex',justifyContent:'flex-end'}}>
          <Button onClick={save} disabled={!!coordinateError} aria-describedby="branch-coordinate-status">Publish Branch Changes</Button>
        </div>
      </Card>}
    </div>
  </div>
}

export function TeamPage({ store }) {
  const { state, actions, toast }=store
  const [tab,setTab]=useState('dentists')
  const [editDentist,setEditDentist]=useState(null)
  const [editStaff,setEditStaff]=useState(null)

  const linkedUser=userId=>state.users.find(u=>u.id===userId)
  const accountStatus=profile=>{
    const u=linkedUser(profile.userId)
    return u?.accountStatus||u?.status||'Unlinked'
  }
  const branchConflict=(profile)=>{
    const names=profile.branches||[profile.branch]
    return names.filter(name=>name&&name!=='All Branches').some(name=>{
      const b=state.branches.find(x=>x.name===name)
      return b && profile.shiftStart && profile.shiftEnd && (profile.shiftStart<b.open || profile.shiftEnd>b.close)
    })
  }
  const availableStatus=profile=>{
    if(accountStatus(profile)!=='Active') return 'Unavailable'
    if(branchConflict(profile)) return 'Conflict'
    return profile.available?'Available':'Unavailable'
  }
  // Phase 2A: dentist/staff profiles are backend-authoritative — same API-first, adopt-confirmed-response
  // pattern as BranchesPage's save/toggleService above.
  const saveDentist=async()=>{
    const result=await syncPersonnelUpdate('dentists',editDentist?.id,editDentist)
    if(!result.ok)return toast(result.message||'Could not save personnel changes.','warning')
    const adopted=actions.adoptPersonnelFromServer('dentists',editDentist.id,result.record)
    if(!adopted.ok)return toast(adopted.message,'warning')
    toast('Personnel changes saved.','success');setEditDentist(null)
  }
  const saveStaff=async()=>{
    const result=await syncPersonnelUpdate('staff',editStaff?.id,editStaff)
    if(!result.ok)return toast(result.message||'Could not save personnel changes.','warning')
    const adopted=actions.adoptPersonnelFromServer('staff',editStaff.id,result.record)
    if(!adopted.ok)return toast(adopted.message,'warning')
    toast('Personnel changes saved.','success');setEditStaff(null)
  }

  return <>
    <PageHeader title="Dentist & Staff Management" text="Personnel records are linked to account access. This screen manages Staff and Dentist profiles, operational shifts, branch assignments, and availability used by scheduling and capacity workflows."/>
    <Notice tone="info" title="Account & personnel synchronization">Create the account first in <b>Access & Roles</b>. Dentist and staff accounts automatically receive a linked personnel profile here. <b>Active</b> comes from the account; <b>Available</b> reflects operational scheduling status.</Notice>
    <Tabs tabs={[{key:'dentists',label:'Dentists',count:state.dentists.length},{key:'staff',label:'Staff',count:state.staff.length}]} active={tab} onChange={setTab}/>
    {tab==='dentists'?<Card title="Dentist profiles & availability" subtitle="License Number • Specialty • Linked Account • Operational availability">
      <Table rows={state.dentists} columns={[
        {key:'name',label:'Dentist'},
        {key:'userId',label:'Linked Account'},
        {key:'licenseNo',label:'License Number'},
        {key:'specialty',label:'Specialty'},
        {key:'branches',label:'Branch assignment',render:d=>d.branches.join(', ')},
        {key:'shift',label:'Shift',render:d=>`${d.shiftStart}–${d.shiftEnd}`},
        {key:'active',label:'Active',render:d=><Status>{accountStatus(d)}</Status>},
        {key:'availability',label:'Available',render:d=><Status>{availableStatus(d)}</Status>},
        {key:'dutyStatus',label:'Duty status',render:d=><span className={`fd-badge ${availableStatus(d)==='Available'?'is-ok':'is-muted'}`}>{availableStatus(d)==='Available'?'Doctor is on duty today':'Off duty'}</span>},
        {key:'action',label:'Action',render:d=><Button size="sm" variant="ghost" onClick={()=>setEditDentist({...d})}>Edit Profile</Button>}
      ]}/>
    </Card>:<Card title="Clinic Staff profiles" subtitle="Every row is linked to its account when account access exists">
      <Table rows={state.staff} columns={[
        {key:'name',label:'Staff member'},
        {key:'userId',label:'Linked Account'},
        {key:'staffType',label:'Staff title'},
        {key:'branch',label:'Branch'},
        {key:'shift',label:'Shift',render:s=>`${s.shiftStart}–${s.shiftEnd}`},
        {key:'active',label:'Active',render:s=><Status>{accountStatus(s)}</Status>},
        {key:'availability',label:'Available',render:s=><Status>{availableStatus(s)}</Status>},
        {key:'action',label:'Action',render:s=><Button size="sm" variant="ghost" onClick={()=>setEditStaff({...s})}>Edit Profile</Button>}
      ]}/>
    </Card>}

    <Modal open={!!editDentist} onClose={()=>setEditDentist(null)} title="Edit dentist profile" subtitle="Account identity/status stays in Users & Access. This form maintains the linked personnel profile and operational assignment.">
      {editDentist&&<div className="form-grid">
        <Field label="User / display name" hint={`Linked user: ${editDentist.userId}`}><input value={editDentist.name} disabled/></Field>
        <Field label="Professional role"><input value={editDentist.staffType||'Dentist'} disabled/></Field>
        <Field label="License Number"><input value={editDentist.licenseNo||''} onChange={e=>setEditDentist({...editDentist,licenseNo:e.target.value})}/></Field>
        <Field label="Specialty"><input value={editDentist.specialty||''} onChange={e=>setEditDentist({...editDentist,specialty:e.target.value})}/></Field>
        <Field label="Branch"><select value={editDentist.branches[0]} onChange={e=>setEditDentist({...editDentist,branches:[e.target.value],branchIds:[state.branches.find(b=>b.name===e.target.value)?.id]})}>{state.branches.map(b=><option key={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Assistant"><select value={editDentist.assistantStaffId||''} onChange={e=>setEditDentist({...editDentist,assistantStaffId:e.target.value||null})}><option value="">Unassigned</option>{state.staff.filter(s=>s.staffType==='Dental Assistant').map(a=><option key={a.id} value={a.id}>{a.name} • {a.branch}</option>)}</select></Field>
        <Field label="Shift start"><input type="time" value={editDentist.shiftStart} onChange={e=>setEditDentist({...editDentist,shiftStart:e.target.value})}/></Field>
        <Field label="Shift end"><input type="time" value={editDentist.shiftEnd} onChange={e=>setEditDentist({...editDentist,shiftEnd:e.target.value})}/></Field>
        <label className="check-control span-2"><input type="checkbox" checked={!!editDentist.available} onChange={e=>setEditDentist({...editDentist,available:e.target.checked})}/><span><b>Available for scheduling</b><small>Active account status is controlled in Users & Access; availability is synchronized to scheduling/workload.</small></span></label>
        {branchConflict(editDentist)&&<Notice tone="warning">Current shift conflicts with the selected branch operating hours.</Notice>}
        <Button className="span-2" onClick={saveDentist}>Save & Synchronize Profile</Button>
      </div>}
    </Modal>

    <Modal open={!!editStaff} onClose={()=>setEditStaff(null)} title="Edit staff profile" subtitle="Update the Staff title, branch assignment, shift, and operational availability used by scheduling.">
      {editStaff&&<div className="form-grid">
        <Field label="User / display name" hint={`Linked user: ${editStaff.userId}`}><input value={editStaff.name} disabled/></Field>
        <Field label="Staff title"><input value={editStaff.staffType||''} onChange={e=>setEditStaff({...editStaff,staffType:e.target.value})}/></Field>
        <Field label="Branch"><select value={editStaff.branch} onChange={e=>setEditStaff({...editStaff,branch:e.target.value,branchId:state.branches.find(b=>b.name===e.target.value)?.id||null})}><option>All Branches</option>{state.branches.map(b=><option key={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Shift start"><input type="time" value={editStaff.shiftStart} onChange={e=>setEditStaff({...editStaff,shiftStart:e.target.value})}/></Field>
        <Field label="Shift end"><input type="time" value={editStaff.shiftEnd} onChange={e=>setEditStaff({...editStaff,shiftEnd:e.target.value})}/></Field>
        <label className="check-control span-2"><input type="checkbox" checked={!!editStaff.available} onChange={e=>setEditStaff({...editStaff,available:e.target.checked})}/><span><b>Available for operations</b><small>Availability is separate from the account's Active/Inactive status.</small></span></label>
        {branchConflict(editStaff)&&<Notice tone="warning">Current shift conflicts with the selected branch operating hours.</Notice>}
        <Button className="span-2" onClick={saveStaff}>Save & Synchronize Profile</Button>
      </div>}
    </Modal>
  </>
}

export function AnalyticsPage({ activeBranch, store }) {
  const { state, toast } = store
  const [period, setPeriod] = useState('Today')
  const [serverSummary, setServerSummary] = useState(null)
  const [serverBranches, setServerBranches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadRequest = useRef(0)
  const isServerSession = !!store.session?.serverUserId

  const activeBranchRecord = state.branches.find(b => b.name === activeBranch)
  // The server resolves a public ULID (preferred) or the transitional legacy reference; never an internal number.
  const activeBranchId = activeBranch === 'All Branches' ? null : (activeBranchRecord?.publicId || activeBranchRecord?.id || null)

  const loadData = async () => {
    const request = ++loadRequest.current
    setLoading(true)
    setLoadError(false)
    // Never keep figures for a previous branch/period on screen while a new request is in flight or after it fails.
    setServerSummary(null)
    setServerBranches(null)
    if (activeBranch !== 'All Branches' && !activeBranchId) { setLoadError(true); setLoading(false); return }
    try {
      const p = period.toLowerCase()
      const summary = await fetchExecutiveSummary({ period: p, branch_id: activeBranchId })
      const branches = await fetchBranchPerformance({ period: p, branch_id: activeBranchId })
      if (request !== loadRequest.current) return
      setServerSummary(summary)
      setServerBranches(branches)
    } catch {
      if (request !== loadRequest.current) return
      // A clinic-server session shows an explicit unavailable state; only the offline demo falls back to local data.
      if (isServerSession) setLoadError(true)
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  React.useEffect(() => {
    loadData()
    return () => { ++loadRequest.current }
  }, [period, activeBranch, activeBranchId, isServerSession])

  const exportServerCsv = async () => {
    try {
      await downloadAnalyticsCsv({ period: period.toLowerCase(), branch_id: activeBranchId })
      toast('Operational analytics CSV exported successfully.', 'success')
    } catch (err) {
      toast(err.message || 'Could not export server CSV.', 'warning')
    }
  }

  // Client-side fallback metrics
  const branchFilter = x => activeBranch === 'All Branches' || x.branch === activeBranch
  const appts = state.appointments.filter(branchFilter)
  const queue = state.queue.filter(branchFilter)
  const hmo = liveRecords(state.hmo).filter(branchFilter)
  const paid = liveRecords(state.invoices).filter(i => i.status === 'Paid' && branchFilter(i))

  const loaded = appointmentWindow(clinicDate())
  const schedulingNote = `Confirmed appointments dated ${dateLabel(loaded.from)} – ${dateLabel(loaded.to)} (the loaded scheduling window, not all-time; the period selector does not apply)${store.appointmentsTruncated?'. Partial: the appointment list limit was reached.':''}`

  const clientMetrics = [
    { name: 'Scheduling', value: appts.filter(a => a.status === 'Confirmed').length, note: schedulingNote, module: 'M6' },
    { name: 'Queue / patient flow', value: queue.filter(q => q.status === 'Served').length, note: 'Patients served from today’s queue (treatment started)', module: 'M9–M10' },
    { name: 'HMO processing', value: hmo.filter(h => h.status === 'Approved').length, note: 'Approved provider outcomes', module: 'M12' },
    store.session?.serverUserId
      // Unavailable is not zero: no authoritative inquiry or conversation count exists for the Owner (the M16 API is Staff-only and M17 is not yet server-backed), and M21 has not defined this report.
      ? { name: 'Communication', value: 'Unavailable', note: 'No authoritative communication count exists yet (M16/M17 reporting is not defined)', module: 'M16–M17' }
      : { name: 'Communication', value: state.inquiries.filter(i => i.status === 'Responded').length + state.conversations.filter(c => c.status === 'Closed').length, note: 'Responded/closed communication records', module: 'M16–M18' },
    { name: 'Recorded revenue', value: peso.format(paid.reduce((s, i) => s + i.total, 0)), note: 'Paid transaction records', module: 'M11' },
  ]

  const rateText = v => (v === null || v === undefined ? 'No data' : `${v}%`)
  const metrics = serverSummary ? [
    { name: 'Recorded revenue', value: peso.format(serverSummary.financials.total_collected_php), note: `Paid invoices created in this period: ${serverSummary.financials.paid_invoices_count} • Gross invoiced: ${peso.format(serverSummary.financials.total_gross_php)}`, module: 'M11' },
    { name: 'Scheduling', value: serverSummary.scheduling.total_appointments, note: `Completion rate: ${rateText(serverSummary.scheduling.completion_rate_pct)} (${serverSummary.scheduling.completed} completed, ${serverSummary.scheduling.cancelled} cancelled)`, module: 'M6' },
    { name: 'Queue / patient flow', value: serverSummary.patient_flow.total_visits, note: `${serverSummary.patient_flow.served_from_queue} served in this period • ${serverSummary.patient_flow.current_waiting} waiting now (today's queue)`, module: 'M9–M10' },
    { name: 'HMO processing', value: serverSummary.hmo.approved, note: `${peso.format(serverSummary.hmo.approved_amount_php)} approved coverage • ${serverSummary.hmo.pending} pending coordinator action`, module: 'M12' },
    { name: 'Automation health', value: rateText(serverSummary.automation.health_rate_pct), note: `${serverSummary.automation.total_actions} rule evaluations recorded (${serverSummary.automation.failed} failed); nothing is executed by this module`, module: 'M23' },
  ] : (isServerSession ? [] : clientMetrics)

  const exportRows = state.branches.map(b => {
    const c = branchCapacity(b.name, state)
    return { Branch: b.name, Workload: c.workload, Waiting: c.waiting, Booked: c.booked, EstimatedWait: c.estimate, Threshold: c.threshold }
  })

  return <>
    <PageHeader
      title="Operational Reporting & Analytics"
      text="Cross-cutting executive intelligence for revenue, queue, scheduling, capacity, HMO, and automation performance. Filtered by branch and authoritative business period."
      aside={<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <select className="compact-select" aria-label="Report period" value={period} onChange={e => setPeriod(e.target.value)}>
          <option>Today</option>
          <option>This Week</option>
          <option>This Month</option>
          <option>This Year</option>
          <option>All Time</option>
        </select>
        <Button onClick={exportServerCsv} variant="secondary">
          Export Report CSV
        </Button>
        <Button onClick={() => window.print()} variant="soft" icon="download">
          Export Analytics PDF
        </Button>
      </div>}
    />
    <OwnerRevenueCharts branchId={activeBranchId} branchName={activeBranch} period={period} serverSession={isServerSession} validBranch={activeBranch === 'All Branches' || !!activeBranchId}/>
    {isServerSession && loadError && <Notice tone="warning">
      Analytics are unavailable right now, so no figures are shown. <Button variant="ghost" onClick={loadData}>Try again</Button>
    </Notice>}
    {isServerSession && loading && !serverSummary && !loadError && <p className="muted-copy" role="status">Loading analytics…</p>}
    <div className="cards-3">
      {metrics.map(m => (
        <Card key={m.name} title={m.name}>
          <div className="analytics-value">{m.value}</div>
          <p className="muted-copy">{m.note}</p>
          <span className="module-inline">{m.module}</span>
        </Card>
      ))}
    </div>
    <div className="grid-2 top-gap">
      <Card title="Branch workload report" subtitle={serverSummary ? `Authoritative comparative data for ${serverSummary.period_label}` : (isServerSession ? undefined : 'Offline demo preview — example capacity values, not clinic data')}>
        <div className="branch-bars">
          {isServerSession && !serverBranches && <p className="muted-copy">{loading ? 'Loading branch figures…' : 'Branch figures are unavailable.'}</p>}
          {(serverBranches || (isServerSession ? [] : state.branches.filter(b => activeBranch === 'All Branches' || b.name === activeBranch))).map(b => {
            const isServer = b.active_queue !== undefined
            // A clinic-server branch has no approved capacity (the stored 80/80/75 thresholds are unconfirmed demo configuration and a queue
            // count is not a percentage), so no workload percentage is computed or drawn. Only the offline demo keeps its labelled example calculation.
            const workload = isServer ? null : branchCapacity(b.name, state).workload
            const threshold = isServer ? null : branchCapacity(b.name, state).threshold
            const estimateKnown = !isServer || (b.estimated_wait_minutes !== null && b.estimated_wait_minutes !== undefined)
            const waiting = isServer ? b.active_queue : branchCapacity(b.name, state).waiting
            const booked = isServer ? b.total_appointments : branchCapacity(b.name, state).booked
            const estimate = isServer ? b.estimated_wait_minutes : branchCapacity(b.name, state).estimate
            const revenue = isServer ? peso.format(b.revenue_collected_php) : null

            return <div key={b.public_id || b.id}>
              <div className="bar-label">
                <span>{b.name}</span>
                {workload === null ? <b>Capacity not configured</b> : <b>{workload}%</b>}
              </div>
              {workload !== null && <Progress value={workload} threshold={threshold} />}
              <small>
                {waiting} waiting now • {booked} appointments{estimateKnown ? ` • ~${estimate} min wait` : ' • wait estimate not configured'}
                {revenue ? ` • Revenue: ${revenue}` : ''}
              </small>
            </div>
          })}
        </div>
      </Card>
      <Card title="Report actions" subtitle="Executive exports & reconciliation">
        <div className="action-stack">
          <Button onClick={exportServerCsv}>Export Executive Analytics CSV</Button>
          <Button variant="soft" onClick={() => window.print()}>Export Analytics PDF with Logo</Button>
          <Button variant="ghost" onClick={() => makeCsv('branch-capacity.csv', exportRows)}>Export Local Capacity CSV</Button>
          <Button variant="ghost" onClick={() => makeCsv('hmo-report.csv', hmo.map(x => ({ Patient: patientName(x.patientId, state.patients), Provider: x.provider, Branch: x.branch, Status: x.status, PendingHours: pendingHours(x, state.clock), Reference: x.reference || '' })))}>Export HMO CSV</Button>
          <Notice tone="info">
            Server analytics calculates metrics across PostgreSQL operational tables for the Manila timezone ({period}).
          </Notice>
        </div>
      </Card>
    </div>
    {!isServerSession && <Card title="Marketing Campaign Impact Tracking" subtitle="Offline example values — not clinic financial results" className="top-gap">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ padding: '12px', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Active Campaigns</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px' }}>3 Promos</b>
          <small style={{ color: 'var(--muted)' }}>Back-to-School, Ortho Promo, Senior Dental</small>
        </div>
        <div style={{ padding: '12px', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Attributed Bookings</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px', color: '#0284c7' }}>48 Visits</b>
          <small style={{ color: 'var(--muted)' }}>+24% vs prior period</small>
        </div>
        <div style={{ padding: '12px', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>New Patients Acquired</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px', color: '#16a34a' }}>32 Patients</b>
          <small style={{ color: 'var(--muted)' }}>66.7% first-time visitors</small>
        </div>
        <div style={{ padding: '12px', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Campaign ROI</span>
          <b style={{ display: 'block', fontSize: '20px', marginTop: '4px', color: '#7c3aed' }}>3.8x Return</b>
          <small style={{ color: 'var(--muted)' }}>₱94,500 attributed revenue</small>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600 }}>Campaign Performance & Acquisition Trend</h4>
        <Table rows={[
          { campaign: 'Back-to-School Cleaning Promo', channel: 'Facebook / Social', dates: 'Sep 1 - Oct 15', clicks: 840, bookings: 26, newPatients: 19, revenue: '₱31,200', status: 'Active' },
          { campaign: 'Braces / Ortho Consultation Drive', channel: 'In-Clinic & Referrals', dates: 'Sep 15 - Present', clicks: 420, bookings: 14, newPatients: 9, revenue: '₱42,000', status: 'Active' },
          { campaign: 'Senior Oral Wellness Campaign', channel: 'Community Outreach', dates: 'Aug 20 - Sep 30', clicks: 210, bookings: 8, newPatients: 4, revenue: '₱21,300', status: 'Completed' },
        ]} columns={[
          { key: 'campaign', label: 'Campaign / Promotion', render: c => <b>{c.campaign}</b> },
          { key: 'channel', label: 'Marketing Channel' },
          { key: 'dates', label: 'Duration' },
          { key: 'bookings', label: 'Attributed Visits', render: c => <strong>{c.bookings}</strong> },
          { key: 'newPatients', label: 'New Patients', render: c => <span style={{ color: '#16a34a', fontWeight: 600 }}>+{c.newPatients}</span> },
          { key: 'revenue', label: 'Attributed Revenue', render: c => <b>{c.revenue}</b> },
          { key: 'status', label: 'Status', render: c => <Status>{c.status}</Status> },
        ]} />
      </div>
    </Card>}
  </>
}

export function UsersPage({ store }) {
  const { toast }=store
  const empty={firstName:'',lastName:'',phone:'',email:'',role:'patient',password:'',passwordConfirmation:''}
  const [form,setForm]=useState(empty)
  const [phoneLocal,setPhoneLocal]=useState('')
  const [records,setRecords]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [submitting,setSubmitting]=useState(false)
  const [edit,setEdit]=useState(null)
  const [editPhoneLocal,setEditPhoneLocal]=useState('')
  const [deleteTarget,setDeleteTarget]=useState(null)
  const [scopeTarget,setScopeTarget]=useState(null)
  const [search,setSearch]=useState('')
  const [roleFilter,setRoleFilter]=useState('all')
  const localPhone=value=>{
    const digits=String(value||'').replace(/\D/g,'')
    if(digits.startsWith('63'))return digits.slice(2,12)
    if(digits.startsWith('0'))return digits.slice(1,11)
    return digits.slice(0,DEFAULT_COUNTRY.digits)
  }
  const load=async()=>{
    setLoading(true);setError('')
    const result=await fetchUserAccounts()
    if(result.ok)setRecords([...(result.records||[])].sort((a,b)=>String(b.id||'').localeCompare(String(a.id||''))))
    else setError(result.message||'Could not load user accounts.')
    setLoading(false)
  }
  React.useEffect(()=>{load()},[])
  const add=async()=>{
    const phone=phoneLocal?normalizePhoneNumber(DEFAULT_COUNTRY.dial,phoneLocal):{ok:true,e164:''}
    if(!phone.ok)return toast(phone.reason,'warning')
    setSubmitting(true)
    const result=await createUserAccountRemote({...form,phone:phone.e164})
    setSubmitting(false)
    if(!result.ok)return toast(result.message||'Could not create the Patient account.','warning')
    setRecords(rows=>[result.record,...rows]);setForm(empty);setPhoneLocal('')
    toast('Patient account created.','success')
  }
  const saveEdit=async()=>{
    if(!edit)return
    const phone=editPhoneLocal?normalizePhoneNumber(DEFAULT_COUNTRY.dial,editPhoneLocal):{ok:true,e164:''}
    if(!phone.ok)return toast(phone.reason,'warning')
    setSubmitting(true)
    const result=await updateUserAccountRemote(edit.id,{...edit,phone:phone.e164})
    setSubmitting(false)
    if(!result.ok)return toast(result.message||'Could not save account information.','warning')
    setRecords(rows=>rows.map(row=>row.id===edit.id?result.record:row));setEdit(null)
    toast('Account information saved.','success')
  }
  const remove=async()=>{
    if(!deleteTarget)return
    setSubmitting(true)
    const result=await deleteUserAccountRemote(deleteTarget.id)
    setSubmitting(false)
    if(!result.ok){setDeleteTarget(null);return toast(result.message||'Could not delete this account.','warning')}
    setRecords(rows=>rows.filter(row=>row.id!==deleteTarget.id));setDeleteTarget(null)
    toast('User account deleted.','success')
  }
    const filteredRecords=useMemo(()=>{
      return records
        .filter(u=>{
          if(roleFilter!=='all'&&u.role!==roleFilter)return false
          if(!search.trim())return true
          const q=search.trim().toLowerCase()
          return (u.name||'').toLowerCase().includes(q)||(u.email||'').toLowerCase().includes(q)||(u.phone||'').includes(q)
        })
        .sort((a,b)=>String(b.id||'').localeCompare(String(a.id||'')))
    },[records,search,roleFilter])

    return <>
    <PageHeader title="User Management" text="Manage user accounts, roles, and account information."/>
    <Notice tone="info" title="Current scope">Patient accounts can be created here directly. Staff and Dentists are invited by email below and set their own password. Roles are read-only after creation.</Notice>
    <div className="grid-2 top-gap">
      <Card title="Create user account" subtitle="Create a Patient login with the clinic’s standard account security.">
        <div className="form-grid">
          <Field label="First name" required><input value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></Field>
          <Field label="Last name" required><input value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></Field>
          <Field label="Mobile number" hint={`Enter 10 digits after ${DEFAULT_COUNTRY.dial}, for example 9171234567.`}><div className="phone-field"><span className="phone-field-code" aria-hidden="true">{DEFAULT_COUNTRY.dial}</span><input type="tel" inputMode="numeric" aria-label="Mobile number" className="phone-field-number" placeholder="9171234567" maxLength={DEFAULT_COUNTRY.digits} value={phoneLocal} onChange={e=>setPhoneLocal(sanitizePhoneInput(e.target.value))}/></div></Field>
          <Field label="Email" required><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field>
          <Field label="Role"><select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="patient">Patient</option><option value="staff" disabled>Staff (use Invite an employee)</option><option value="dentist" disabled>Dentist (use Invite an employee)</option></select></Field>
          <Field label="Initial Password" required hint="At least 8 characters with letters and numbers."><input type="password" autoComplete="new-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></Field>
          <Field label="Confirm Password" required><input type="password" autoComplete="new-password" value={form.passwordConfirmation} onChange={e=>setForm({...form,passwordConfirmation:e.target.value})}/></Field>
          <Button className="span-2" onClick={add} disabled={submitting}>{submitting?'Creating…':'Create Patient Account'}</Button>
        </div>
      </Card>
      <Card title="Account roles" subtitle="Roles are authorization categories. Staff job titles are maintained separately in personnel management."><div className="permission-list"><div><b>Patient</b><span>Patient portal access</span></div><div><b>Staff</b><span>Invited by email by the Owner; sets their own password</span></div><div><b>Dentist</b><span>Invited by email by the Owner; sets their own password</span></div></div></Card>
    </div>
    <EmployeeInvitations store={store}/>
    <Card className="top-gap" title="User accounts" subtitle="Only real backend login accounts appear here.">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search accounts by name, email, or phone…"
        filters={[
          {
            key: 'role',
            label: 'Role',
            value: roleFilter,
            onChange: setRoleFilter,
            options: [
              { value: 'all', label: 'All roles' },
              { value: 'patient', label: 'Patient' },
              { value: 'staff', label: 'Staff' },
              { value: 'dentist', label: 'Dentist' },
              { value: 'owner', label: 'Owner' },
            ],
          },
        ]}
        count={filteredRecords.length}
        totalCount={records.length}
        onReset={()=>{setSearch('');setRoleFilter('all')}}
      />
      {loading?<p className="muted-copy" role="status">Loading user accounts…</p>:error?<Notice tone="warning" title="Couldn’t load user accounts">{error}<Button size="sm" variant="ghost" onClick={load}>Try again</Button></Notice>:<Table rows={filteredRecords} caption="User accounts" columns={[
        {key:'name',label:'Name'}, {key:'email',label:'Email'}, {key:'phone',label:'Phone',render:u=>u.phone||'—'},
        {key:'role',label:'Role',render:u=>u.role==='owner'?'Owner':u.role==='dentist'?'Dentist':u.role==='staff'?'Staff':'Patient'},
        {key:'action',label:'Actions',render:u=><div className="row-actions">{u.role==='staff'&&<Button size="sm" variant="soft" onClick={()=>setScopeTarget(u)}>Branch access</Button>}<Button size="sm" variant="ghost" onClick={()=>{setEdit({...u});setEditPhoneLocal(localPhone(u.phone))}}>Edit</Button><Button size="sm" variant="danger" onClick={()=>setDeleteTarget(u)}>Delete</Button></div>}
      ]}/>}
    </Card>
    {scopeTarget&&<BranchAccessDialog user={scopeTarget} branches={store.state.branches||[]} onClose={()=>setScopeTarget(null)} onSaved={()=>toast('Branch access saved.','success')}/>}
    <Modal open={!!edit} onClose={()=>setEdit(null)} title="Edit user account" subtitle="Role and personnel information are read-only here.">
      {edit&&<div className="form-grid"><Field label="First name" required><input value={edit.firstName} onChange={e=>setEdit({...edit,firstName:e.target.value})}/></Field><Field label="Last name" required><input value={edit.lastName} onChange={e=>setEdit({...edit,lastName:e.target.value})}/></Field><Field label="Email" required><input type="email" value={edit.email} onChange={e=>setEdit({...edit,email:e.target.value})}/></Field><Field label="Mobile number" hint={`Enter 10 digits after ${DEFAULT_COUNTRY.dial}, or leave blank.`}><div className="phone-field"><span className="phone-field-code" aria-hidden="true">{DEFAULT_COUNTRY.dial}</span><input type="tel" inputMode="numeric" aria-label="Mobile number" className="phone-field-number" placeholder="9171234567" maxLength={DEFAULT_COUNTRY.digits} value={editPhoneLocal} onChange={e=>setEditPhoneLocal(sanitizePhoneInput(e.target.value))}/></div></Field><Field label="Role" hint="Role cannot be changed from User Management."><input value={edit.role==='owner'?'Owner':edit.role==='dentist'?'Dentist':edit.role==='staff'?'Staff':'Patient'} readOnly disabled aria-label="Role"/></Field><Button className="span-2" onClick={saveEdit} disabled={submitting}>{submitting?'Saving…':'Save Account Information'}</Button></div>}
    </Modal>
    <ConfirmDialog open={!!deleteTarget} title="Delete user account" onCancel={()=>setDeleteTarget(null)} onConfirm={remove} confirmLabel="Delete account"><p>Delete access for <b>{deleteTarget?.name}</b>? The account will be removed from login while the person and clinical records remain preserved.</p></ConfirmDialog>
  </>
}

export function AutomationPage({ store }) {
  const { state, toast } = store
  const monitor = automationSnapshot(state)
  if (store.session && store.session.role !== 'owner') return <Notice>Automation monitoring is available to Owner/Admin.</Notice>

  const [serverData, setServerData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const isServerSession = !!store.session?.serverUserId
  const [observation, setObservation] = useState('')
  const [runningRule, setRunningRule] = useState(false)
  const [selectedRuleCode, setSelectedRuleCode] = useState('R2_HMO_FOLLOWUP_REMINDER')
  const [filterStatus, setFilterStatus] = useState('all')
  const [testEmailRecipient, setTestEmailRecipient] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState(null)

  const handleSendTestEmail = async () => {
    setTestingEmail(true)
    setTestEmailResult(null)
    try {
      const res = await sendTestEmail(testEmailRecipient.trim() || undefined)
      // M18 (TD-25): show exactly what the server knows — a log mailer sends nothing; transport acceptance is not inbox delivery.
      const info = res.ok ? (res.data || {}) : null
      if (res.ok) {
        const local = info.status === 'logged_only'
        setTestEmailResult({ tone: local ? 'warning' : 'info', title: local ? 'Not emailed (local mail log only)' : 'Accepted by the mail transport', message: info.message || 'Inbox delivery is not confirmed.' })
        toast(local ? 'Test email recorded locally only.' : 'Test email accepted by the mail transport.', local ? 'warning' : 'info')
      } else {
        setTestEmailResult({ tone: 'warning', title: 'Send failed', message: res.message || 'The test email could not be sent.' })
        toast(res.message || 'Test email failed.', 'warning')
      }
    } catch (err) {
      setTestEmailResult({ tone: 'warning', title: 'Error', message: err.message || 'Unexpected network error.' })
    } finally {
      setTestingEmail(false)
    }
  }

  const refreshServer = async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setServerData(await fetchAutomationSnapshot())
    } catch {
      // A clinic-server session shows an explicit unavailable state; only the offline demo uses its local, labelled records.
      setServerData(null)
      if (isServerSession) setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    refreshServer()
  }, [])

  // Only these rules take an Owner-typed observation. R4 never takes clinical flags: a manual flag is not a Dentist's decision.
  // The limits mirror the server's validation (0–8760 hours, 0–1440 minutes); the server remains the authority.
  const observationField = { R2_HMO_FOLLOWUP_REMINDER: { key: 'pending_hours', label: 'Hours the HMO case has been pending', max: 8760 }, R3_CAPACITY_ALERT: { key: 'estimated_wait_minutes', label: 'Estimated wait (minutes)', max: 1440 } }[selectedRuleCode]
  const observationValid = !observationField || (/^\d{1,5}$/.test(observation) && Number(observation) <= observationField.max)
  const runDiagnostic = async () => {
    if (!observationValid) return
    try {
      setRunningRule(true)
      const payload = { diagnostic_check: true }
      if (observationField) payload[observationField.key] = Number(observation)
      if (selectedRuleCode === 'R1_APPT_LIFECYCLE') payload.action_type = 'created'
      const res = await dispatchAutomationRule(selectedRuleCode, payload)
      toast(res.message || 'Rule evaluation recorded. No business action was performed.', 'success')
      await refreshServer()
    } catch (err) {
      toast(err.message || 'Failed to trigger rule evaluation.', 'warning')
    } finally {
      setRunningRule(false)
    }
  }

  const exportCsv = async () => {
    try {
      await downloadAutomationCsv({ status: filterStatus })
      toast('Automation activity CSV exported successfully.', 'success')
    } catch (err) {
      toast(err.message || 'Could not export CSV.', 'warning')
    }
  }

  // Share of recorded rule evaluations that finished without a warning or failure; null (shown as "No data") when none exist.
  const showLocal = !isServerSession
  const rate = serverData ? serverData.health_rate : (showLocal && state.workflowLog.length ? Math.round((monitor.success / state.workflowLog.length) * 100) : null)
  const activeRulesCount = serverData ? serverData.active_rules_count : (showLocal ? state.automations.filter(r => r.enabled).length : null)
  const failedCount = serverData ? serverData.failed_count : (showLocal ? monitor.failed.length : null)
  const totalActions = serverData ? serverData.total_actions : (showLocal ? state.workflowLog.length : null)
  const stat = v => (v === null || v === undefined ? '—' : v)

  const rulesList = serverData?.rules || (!showLocal ? [] : state.automations.map(r => ({
    id: r.id,
    rule_code: r.triggerEvent,
    name: r.event,
    action: r.action,
    condition: r.condition,
    owner: r.owner,
    is_active: r.enabled,
    last_status: r.lastResult || 'Active',
  })))

  const actionsList = serverData?.recent_actions || (!showLocal ? [] : state.workflowLog.map(e => ({
    id: e.id,
    executed_at_human: e.at,
    event_type: e.event,
    rule_code: e.domain,
    result_summary: e.result,
    status: e.status,
    actor: { name: state.users.find(u => u.id === e.actorUserId)?.name || e.actorUserId || 'Historical' },
    aggregate: e.entityType ? { type: e.entityType, id: e.entityId } : null,
  })))

  // A stored description from before the truthfulness correction names a proposed action; it is shown only as such, never as proof.
  const isLegacy = x => x.summary_kind === 'legacy_proposed_description'
  const resultText = x => (isLegacy(x) ? `Legacy description of a proposed action (nothing was executed): “${x.result_summary}”` : (x.result_summary || x.result))
  // Exceptions come from the server record only; a clinic-server session never shows local demo log entries.
  const exceptionsList = serverData ? (serverData.recent_exceptions || []) : (showLocal ? [...monitor.failed, ...monitor.warnings] : [])

  const filteredActions = filterStatus === 'all'
    ? actionsList
    : actionsList.filter(a => a.status.toLowerCase() === filterStatus.toLowerCase())

  return <>
    <PageHeader
      kicker="System orchestration"
      title="Automation monitor"
      text="Monitor recorded rule evaluations, failures and warnings. Rules are read-only. This module evaluates and records only: it does not create invoices, tasks, notifications or messages, and no background worker or external delivery is connected. Threshold values shown are unconfirmed demonstration values, not clinic policy."
      aside={<div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={refreshServer} disabled={loading} variant="secondary">
          {loading ? 'Refreshing…' : 'Refresh Snapshot'}
        </Button>
        <Button onClick={exportCsv} variant="secondary">
          Export CSV
        </Button>
      </div>}
    />
    {isServerSession && loadError && <Notice tone="warning">
      The automation record is unavailable right now, so no figures are shown. <Button variant="ghost" onClick={refreshServer}>Try again</Button>
    </Notice>}
    {!isServerSession && <Notice tone="info">Offline demo preview — local example records, not clinic data.</Notice>}
    <div className="stats-grid">
      <StatCard label="Evaluation health" value={rate === null ? 'No data' : `${rate}%`} hint="Recorded rule evaluations that finished without a warning or failure (nothing is executed)" />
      <StatCard label="Rules in the registry" value={stat(activeRulesCount)} hint="Evaluated only; values are demonstration defaults" tone="blue" />
      <StatCard label="Failed evaluations" value={stat(failedCount)} hint="Recorded evaluations that could not run" tone="amber" />
      <StatCard label="Recorded evaluations" value={stat(totalActions)} hint="Central evaluation record" tone="purple" />
    </div>

    <Card title="Run Diagnostic Evaluation" subtitle="Record an evaluation of a rule against a value you enter. Evaluation only: nothing is executed and no clinical decision can be supplied." className="top-gap">
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '280px', flex: 1 }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
            Select Workflow Rule
          </label>
          <select
            value={selectedRuleCode}
            onChange={e => { setSelectedRuleCode(e.target.value); setObservation('') }}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d0d7de', fontSize: '13px' }}
          >
            <option value="R1_APPT_LIFECYCLE">R1 — Appointment lifecycle event (evaluation only)</option>
            <option value="R2_HMO_FOLLOWUP_REMINDER">R2 — HMO pending time (demonstration threshold)</option>
            <option value="R3_CAPACITY_ALERT">R3 — Estimated wait (demonstration threshold)</option>
            <option value="R4_TREATMENT_DOWNSTREAM">R4 — Treatment completed event (evaluation only)</option>
            <option value="R5_MESSAGE_ROUTING">R5 — Message received event (evaluation only)</option>
            <option value="R6_USER_PROFILE_SYNC">R6 — User change event (evaluation only)</option>
          </select>
        </div>
        {observationField && <div style={{ minWidth: '200px' }}>
          <Field label={observationField.label}>
            <input type="number" min="0" max={observationField.max} step="1" inputMode="numeric" required value={observation} onChange={e => setObservation(e.target.value)} />
          </Field>
        </div>}
        <Button onClick={runDiagnostic} disabled={runningRule || !observationValid}>
          {runningRule ? 'Evaluating Rule…' : 'Run Rule Evaluation'}
        </Button>
        <small className="block-muted" style={{ flexBasis: '100%' }}>Each run records a separate evaluation; a repeated run is not de-duplicated.</small>
      </div>
    </Card>

    <div className="grid-2 top-gap">
      <Card title="Workflow health" subtitle="Rules evaluated by this module. Their proposed actions are not executed.">
        <div className="automation-rule-list">
          {rulesList.map(r => (
            <div className="automation-rule-row" key={r.id || r.rule_code}>
              <div className="automation-rule-icon">{r.is_active !== false ? '✓' : '—'}</div>
              <div>
                <b>{r.name || r.rule_code}</b>
                <span>Proposed action (not performed by this module): {r.action}</span>
                <small>{r.owner || 'System'} • {r.condition}</small>
              </div>
              <Status tone={r.is_active !== false ? 'success' : 'neutral'}>
                {r.is_active !== false ? 'Active' : 'Inactive'}
              </Status>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Recorded exceptions" subtitle="Historical failed attempts and warnings; current case status determines the next action">
        <div className="alert-list">
          {exceptionsList.length > 0 ? (
            exceptionsList.map(x => (
              <div className="alert warning" key={x.id}>
                <div>
                  <b>{x.event_type || x.event || x.rule_name}</b>
                  <span>{resultText(x)}</span>
                  <small>{x.executed_at_human || x.createdAt || x.at} • {x.aggregate?.type || x.entityType || 'Action'} {x.aggregate?.id || x.entityId || ''}</small>
                </div>
                <Status tone={x.status === 'Failed' ? 'critical' : 'warning'}>{x.status}</Status>
              </div>
            ))
          ) : (isServerSession && !serverData ? (
            <Notice tone="info" title="Exceptions unavailable">{loading ? 'Loading…' : 'The automation record could not be loaded.'}</Notice>
          ) : (
            <Notice tone="success" title="No recorded exceptions">
              No failed evaluations or warnings are present in the current record.
            </Notice>
          ))}
        </div>
      </Card>
    </div>

    <Card className="top-gap" title="Email sending check" subtitle="Shows whether the clinic mail transport accepts a test message. Only receiving it in the inbox proves delivery.">
      <div style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p className="text-secondary text-sm">
          Send a test email through the clinic's configured mail transport. The result says whether it was only logged locally, accepted by the transport, or failed. It creates no patient record.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Field label="Test recipient email">
              <input
                type="email"
                placeholder="owner@example.test (or leave blank for self)"
                value={testEmailRecipient}
                onChange={e => setTestEmailRecipient(e.target.value)}
              />
            </Field>
          </div>
          <Button
            onClick={handleSendTestEmail}
            disabled={testingEmail}
            variant="secondary"
          >
            {testingEmail ? 'Sending…' : 'Send Test Email'}
          </Button>
        </div>
        {testEmailResult && (
          <Notice tone={testEmailResult.tone} title={testEmailResult.title}>
            {testEmailResult.message}
          </Notice>
        )}
      </div>
    </Card>

    <Card className="top-gap" title="Recent automation activity" subtitle="Recorded rule evaluations. A row is not evidence that any invoice, task, notification or message was created.">
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
        <button
          className={`tab-btn ${filterStatus === 'all' ? 'active' : ''}`}
          onClick={() => setFilterStatus('all')}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #d0d7de', background: filterStatus === 'all' ? 'var(--brand-soft)' : '#fff', cursor: 'pointer', fontSize: '12px' }}
        >
          All
        </button>
        <button
          className={`tab-btn ${filterStatus === 'success' ? 'active' : ''}`}
          onClick={() => setFilterStatus('success')}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #d0d7de', background: filterStatus === 'success' ? 'var(--brand-soft)' : '#fff', cursor: 'pointer', fontSize: '12px' }}
        >
          Success
        </button>
        <button
          className={`tab-btn ${filterStatus === 'warning' ? 'active' : ''}`}
          onClick={() => setFilterStatus('warning')}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #d0d7de', background: filterStatus === 'warning' ? 'var(--brand-soft)' : '#fff', cursor: 'pointer', fontSize: '12px' }}
        >
          Warning
        </button>
        <button
          className={`tab-btn ${filterStatus === 'failed' ? 'active' : ''}`}
          onClick={() => setFilterStatus('failed')}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #d0d7de', background: filterStatus === 'failed' ? 'var(--brand-soft)' : '#fff', cursor: 'pointer', fontSize: '12px' }}
        >
          Failed
        </button>
      </div>
      <Table rows={filteredActions} columns={[
        { key: 'at', label: 'Time', render: a => a.executed_at_human || a.at },
        { key: 'rule', label: 'Workflow Rule', render: a => a.rule_name || a.rule_code || eventModuleLabel(a) },
        { key: 'entity', label: 'Affected record', render: a => a.aggregate ? `${a.aggregate.type} • ${a.aggregate.id}` : `${a.entityType || 'Legacy'} • ${a.entityId || 'Not linked'}` },
        { key: 'actor', label: 'Actor', render: a => a.actor?.name || state.users.find(u => u.id === a.actorUserId)?.name || a.actorUserId || 'Historical record' },
        { key: 'event', label: 'Event', render: a => a.event_type || a.event },
        { key: 'result', label: 'Result', render: a => <>{resultText(a)}{a.execution === 'evaluation_only' && <small className="block-muted">{isLegacy(a) ? 'Evaluation only — this older wording is a proposed action, not evidence that anything was done.' : 'Evaluation only — no business action was performed.'}</small>}</> },
        { key: 'status', label: 'Status', render: r => <Status tone={r.status === 'Success' ? 'success' : r.status === 'Warning' ? 'warning' : 'critical'}>{r.status}</Status> }
      ]} />
    </Card>
  </>
}

export function EngagementPage({ role, store }) {
  const { state, setters, actions, toast, log, session }=store
  const [tab,setTab]=useState('loyalty')
  const [campaign,setCampaign]=useState({name:'',type:'Reactivation',audience:'Patients overdue for routine recall',channel:'SMS',scheduled:'2026-09-25 09:00'})
  const patients=state.patients.filter(p=>canManageLoyalty(state,session,p.id))
  const accounts=Array.isArray(state.loyalty)?state.loyalty.filter(l=>canManageLoyalty(state,session,l?.patientId)):[]
  const [loyaltyForm,setLoyaltyForm]=useState({patientId:patients[0]?.id||'',activity:'Qualified Visit',points:20})
  const recordCommand=useRef({key:'',id:''})
  const createCampaign=()=>{if(!campaign.name)return toast('Enter a campaign name.','warning');setters.setCampaigns(xs=>[{id:uid('camp'),...campaign,status:'Draft',responses:0,reactivated:0},...xs]);log(role==='owner'?ROLE_INFO.owner.name:ROLE_INFO.staff.name,'Created optional engagement campaign','campaign');toast('Campaign draft created. Nothing is sent.','success');setCampaign({...campaign,name:''})}
  // M24 writes go through the shared commands, which validate the session, scope, ledger and replay.
  const applyLoyalty=()=>{
    // One command ID per form values and ledger state: a rapid second click replays it instead of recording twice.
    const size=accounts.find(l=>l.patientId===loyaltyForm.patientId)?.history?.length??0, key=`${loyaltyForm.patientId}|${loyaltyForm.activity}|${loyaltyForm.points}|${size}`
    if(recordCommand.current.key!==key)recordCommand.current={key,id:uid('loyalty')}
    const result=actions.recordLoyaltyActivity({patientId:loyaltyForm.patientId,activity:loyaltyForm.activity,points:Number(loyaltyForm.points)},recordCommand.current.id)
    if(!result.ok)return toast(result.message,'warning')
    toast(result.unchanged?'This activity was already recorded.':'Qualified activity recorded and loyalty balance updated once.','success')
  }
  const pendingOf=l=>Array.isArray(l.history)?l.history.find(h=>h?.type==='Redemption Request'&&h.status==='Pending'):null
  const processRedemption=l=>{
    const pending=pendingOf(l)
    if(!pending)return
    const result=actions.processLoyaltyRedemption(l.id,`process:${pending.id||`${l.id}:${l.history.length}`}`)
    if(!result.ok)return toast(result.message,'warning')
    toast(result.unchanged?'This redemption was already processed.':'Redemption processed and loyalty balance updated.','success')
  }
  return <>
    <PageHeader title="Patient Engagement" text="Referral & loyalty administration, and the preview of optional marketing and reactivation campaigns, kept separate from core clinic operations."/>
    <Notice tone="info" title="Optional engagement programs">Referral & Loyalty is a team-designed prototype program for demonstration; it is not an established clinic program. Marketing & Reactivation has only a limited campaign-draft preview today, and full management is planned for a later phase. Neither blocks core care operations.</Notice>
    <Tabs tabs={[{key:'loyalty',label:'Referral & Loyalty'},{key:'campaigns',label:'Marketing & Reactivation'}]} active={tab} onChange={setTab}/>
    {tab==='loyalty'?<>
      <div className="grid-2">
        <Card title="Record qualified referral / loyalty activity" subtitle="Validates activity before applying a configured reward once"><div className="form-grid"><Field label="Patient"><select value={loyaltyForm.patientId} onChange={e=>setLoyaltyForm({...loyaltyForm,patientId:e.target.value})}>{patients.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Activity"><select value={loyaltyForm.activity} onChange={e=>setLoyaltyForm({...loyaltyForm,activity:e.target.value})}><option>Qualified Visit</option><option>Qualified Referral</option></select></Field><Field label="Reward / points"><input type="number" min="1" step="1" value={loyaltyForm.points} onChange={e=>setLoyaltyForm({...loyaltyForm,points:e.target.value})}/></Field><Button onClick={applyLoyalty}>Validate & Apply Reward Once</Button></div></Card>
        <Card title="Referral & loyalty rules"><Notice tone="info">Prototype rules designed by the project team, not historical clinic policy: a Patient can request a {LOYALTY_PROGRAM.redemptionThreshold}-point reward once they have {LOYALTY_PROGRAM.redemptionThreshold} points, only one request can be Pending at a time, and each request is processed once. Points must be whole positive numbers (a prototype validation rule) and are recorded here after a qualified visit or referral. Recording a Patient’s first qualified activity creates their loyalty account and referral code. The reward itself is not defined in this prototype, and referred-Patient tracking is not yet modeled. Actual reward rules would be server-controlled in production.</Notice></Card>
      </div>
      <Card className="top-gap" title="Loyalty accounts"><Table rows={accounts} columns={[{key:'patient',label:'Patient',render:l=>patientName(l.patientId,state.patients)},{key:'code',label:'Referral code',render:l=>l.referralCode},{key:'points',label:'Balance',render:l=>ledgerIssue(l)?'Under review':`${l.points} pts`},{key:'history',label:'Latest activity',render:l=>Array.isArray(l.history)&&l.history[0]?`${l.history[0].type} • ${l.history[0].at}`:'—'},{key:'action',label:'Redemption',render:l=>pendingOf(l)&&!ledgerIssue(l)?<Button size="sm" onClick={()=>processRedemption(l)}>Process request</Button>:'—'}]} /></Card>
    </>:<>
      <div className="grid-2"><Card title="Campaign draft (preview)"><div className="form-grid"><Field label="Campaign name"><input value={campaign.name} onChange={e=>setCampaign({...campaign,name:e.target.value})}/></Field><Field label="Type"><select value={campaign.type} onChange={e=>setCampaign({...campaign,type:e.target.value})}><option>Reactivation</option><option>Feedback</option><option>Engagement</option></select></Field><Field label="Target patient group"><input value={campaign.audience} onChange={e=>setCampaign({...campaign,audience:e.target.value})}/></Field><Field label="Channel"><select value={campaign.channel} onChange={e=>setCampaign({...campaign,channel:e.target.value})}><option>SMS</option><option>Portal</option><option>Email</option></select></Field><Field label="Scheduled outreach"><input value={campaign.scheduled} onChange={e=>setCampaign({...campaign,scheduled:e.target.value})}/></Field><Button onClick={createCampaign}>Create Draft Campaign</Button></div></Card><Card title="Campaign boundaries"><Notice tone="info">Campaign management, targeting and consent rules are planned for a later phase; this draft form is a preview and sends nothing. Operational confirmations, queue notices, delay updates, and follow-up reminders stay separate from marketing and reactivation outreach.</Notice></Card></div>
      <Card className="top-gap" title="Campaigns"><Table rows={state.campaigns} columns={[{key:'name',label:'Campaign'},{key:'type',label:'Type'},{key:'audience',label:'Audience'},{key:'channel',label:'Channel'},{key:'scheduled',label:'Schedule'},{key:'responses',label:'Responses / feedback'},{key:'reactivated',label:'Reactivated'},{key:'status',label:'Status',render:c=><Status>{c.status}</Status>}]} /></Card>
    </>}
  </>
}
