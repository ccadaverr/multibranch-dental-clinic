import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, resolveEncounter } from '../encounter.js'
import { ClinicalNavigation } from '../clinical-navigation.jsx'
import React, { lazy, Suspense, useEffect, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, Notice, PageHeader, RefreshButton, SearchInput, FilterBar } from '../components.jsx'
import { patientChart, listVisits, listTreatments } from '../api-client.js'
import { Odontogram, toothLabel } from '../components/odontogram/index.js'
import {clinicalChartValid,readClinicalChart,readChartVisitPatients} from '../chart-read.js'
import '../chart-experience.css'
import {discoveryRange,shiftDiscoveryRange} from '../history-read.js'
import '../history-experience.css'
import {addDays} from '../clock.js'
import {todayManila} from '../patient/format.js'
import {beginChartCommand,chartMatches,chartReady} from '../chart-command.js'

const InlineHistory=lazy(()=>import('./ClinicalHistory.jsx').then(m=>({default:m.ClinicalHistory})))

export { toothLabel } from '../components/odontogram/index.js'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'

/** Unified ChartView (shared between Dentist page, Staff patient record, and drawer) */
export function ChartView(props) {
  return <ChartRecord key={clinicalSessionKey(props.store?.session)+props.patientId+'|'+props.store?.getAuthGeneration?.()+'|'+(props.recordContext?.treatmentId||'')} {...props}/>
}
function ChartRecord({ patientId, canRecord, toast, store, recordContext = null, onDirtyChange, isCurrent = () => true }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [picked, setPicked] = useState(null), [attempt,setAttempt]=useState(0)
  const live=React.useRef(true), recording=React.useRef(false)
  const actor=React.useRef({key:clinicalSessionKey(store?.session),auth:store?.getAuthGeneration?.()}),latest=React.useRef(store);latest.current=store
  const command=React.useRef(null),link=React.useRef(recordContext)
  const [historyTarget,setHistoryTarget]=useState(null),historyButton=React.useRef(null),closeHistory=React.useRef(null),chartRoot=React.useRef(null)
  useEffect(()=>{if(historyTarget){closeHistory.current?.focus();closeHistory.current?.scrollIntoView({block:'start'})}},[historyTarget])
  const [feedback,setFeedback]=useState(null),[reviewOpen,setReviewOpen]=useState(false)
  const dirty=React.useRef(false), editGeneration=React.useRef(0)
  const scope=React.useRef({canRecord,isCurrent})
  scope.current={canRecord,isCurrent}
  const ownsChart=()=>live.current&&scope.current.isCurrent()&&actor.current.key===clinicalSessionKey(latest.current?.session)&&actor.current.auth===latest.current?.getAuthGeneration?.()
  const register=React.useContext(ClinicalNavigation)
  // Match the shared navigation ref contract, with synchronous reads of the
  // current patient/editor. Tooth edits need not wait for a React state update.
  const protection=React.useRef({
    get dirty(){return !!scope.current.canRecord&&ownsChart()&&dirty.current},
    get busy(){return !!scope.current.canRecord&&ownsChart()&&recording.current},
  })
  const [recordingPending, setRecordingPending] = useState(false)
  React.useLayoutEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  React.useLayoutEffect(()=>{
    if(canRecord)return register?.(protection)
  },[canRecord,register])
  useEffect(()=>{
    if(!canRecord)return
    const warn=event=>{
      if(protection.current.dirty||protection.current.busy){event.preventDefault();event.returnValue=''}
    }
    window.addEventListener('beforeunload',warn)
    return()=>window.removeEventListener('beforeunload',warn)
  },[canRecord])
  const reportDirty=value=>{
    if(!canRecord||!ownsChart())return
    dirty.current=!!value;editGeneration.current++
    onDirtyChange?.(!!value)
  }

  useEffect(() => {
    let current=true;setData(null);setError('');setFeedback(null)
    readClinicalChart(()=>patientChart(patientId),patientId,()=>current&&ownsChart()).then(r=>{
      if(current&&ownsChart()){if(r.ok)setData(r.data);else setError(r.message||'The chart could not be verified. Retry to read saved findings.')}
    })
    return()=>{current=false}
  }, [patientId,attempt])

  const dentist=store?.state?.dentists?.find(d=>d.id===store?.session?.dentistId)
  const branches = (store?.state?.branches || []).filter(b=>link.current?.branchId?b.id===link.current.branchId:!canRecord||dentist?.branchIds?.includes(b.id))
  const activeBranchId = link.current?.branchId || store?.session?.branchId || null
  const writable=canRecord&&chartReady(data)&&(data.settings?.statuses?.length||0)>0

  const handleRecord = async (payload, ownsEditor = () => true) => {
    if(!scope.current.canRecord||!chartReady(data)||!ownsChart()||recording.current)return {ok:false,message:'Recording is unavailable or already in progress.'}
    const submittedGeneration=editGeneration.current
    recording.current=true; setRecordingPending(true)
    try {
      const context=link.current?.treatmentId?{treatment_id:link.current.treatmentId,expected_treatment_revision:link.current.revision}:{}
      const submitted={...payload,...context}
      if(command.current?.outcome==='unknown'&&JSON.stringify(command.current.intent)!==JSON.stringify(submitted))return {ok:false,uncertain:true,message:'Retry the original finding on its selected tooth, or review the saved chart before another command.'}
      if(!command.current||command.current.outcome!=='unknown')command.current=beginChartCommand({patientId,payload:submitted,dentistId:store?.session?.dentistId,isCurrent:ownsChart,verifyChart:row=>clinicalChartValid(row,patientId)})
      const res = await command.current.submit()
      if(!scope.current.canRecord||!ownsChart())return {ok:false,message:'The chart context changed.'}
      if (res.ok) {
        // Authoritative data belongs to this patient; transient feedback also
        // requires the original tooth selection and edit generation to remain current.
        let current=res.data,needsReview=false,message=''
        if(res.recovered){
          const read=await readClinicalChart(()=>patientChart(patientId),patientId,ownsChart)
          if(!ownsChart())return {ok:false,message:'The chart context changed.'}
          if(read?.ok&&chartMatches(read.data,patientId)&&chartReady(read.data)&&read.data.history.some(e=>e.id===res.entryId)){
            current=read.data;needsReview=current.tooth_revisions[payload.tooth]!==res.revision
            if(needsReview)message='This finding is saved, and a newer tooth revision is visible. Review the saved chart before another entry; your draft is retained.'
          }else{needsReview=true;message='The original finding is saved. This is its original snapshot; current chart status could not be verified. Review the saved chart before another entry.'}
        }
        setData(current);setFeedback({ok:true,message:`Finding ${res.entryId} saved for tooth ${payload.tooth}, revision ${res.revision}.`+(message?' '+message:'')})
        if (ownsEditor()&&editGeneration.current===submittedGeneration) toast?.('Tooth ' + toothLabel(payload.tooth, data.settings?.numbering) + ' recorded.', 'success')
        return { ok: true,revision:res.revision,needsReview,message }
      }
      const message=firstError(res);setFeedback({ok:false,message})
      return { ok: false,uncertain:res.uncertain,needsReview:res.kind==='conflict',message }
    } catch {
      return { ok: false, message: 'The finding could not be confirmed. Check the chart before retrying.' }
    } finally {
      recording.current=false
      if(ownsChart())setRecordingPending(false)
    }
  }

  return (
    <div ref={chartRoot} className="tc-unified-chart clinical-odontogram">
      <div className="chart-read-heading"><div><h3>Current dental chart{!canRecord?' · Read-only':''}</h3><p>{data?.patient?.name||'Patient '+patientId}</p></div><RefreshButton recovery={Boolean(dirty.current || command.current?.outcome==='unknown')} title="Review saved chart" ariaLabel="Review saved chart" loading={!data&&!error} disabled={recordingPending} onClick={()=>{if(dirty.current||command.current?.outcome==='unknown')setReviewOpen(true);else{command.current=null;setAttempt(a=>a+1)}}}/></div>
      {error&&<Notice tone="warning" title="Chart unavailable"><p>{error}</p><Button variant="ghost" onClick={()=>setAttempt(a=>a+1)}>Retry chart</Button></Notice>}
      {!data&&!error&&<p className="au-muted" role="status">Loading the chart…</p>}
      {data&&<>
      {canRecord&&!writable&&<Notice tone="warning">Recording is unavailable in this session. Saved findings remain read-only.</Notice>}
      <Odontogram
        data={data}
        selected={picked}
        onSelect={setPicked}
        allow3d={store?.session?.role === 'dentist'}
        encounter={recordContext}
        canRecord={writable}
        onRecord={handleRecord}
        onReviewEncounter={store?.session?.role==='dentist'?(target,trigger)=>{historyButton.current=trigger||document.activeElement;setHistoryTarget(target)}:undefined}
        branches={branches}
        activeBranchId={activeBranchId}
        recordingPending={recordingPending}
        onDirtyChange={reportDirty}
      />
      {historyTarget&&<section className="chart-history-review" aria-label="Linked encounter review"><Button ref={closeHistory} variant="ghost" onClick={()=>{setHistoryTarget(null);if(historyButton.current?.isConnected)historyButton.current.focus();else chartRoot.current?.querySelector('.od-tooth-chooser select')?.focus()}}>Close encounter review</Button><p>Read-only completed encounter. Your finding draft stays in place.</p><Suspense fallback={<p role="status">Opening saved encounter…</p>}><InlineHistory store={store} patient={{id:patientId}} selectedId={historyTarget.id} expectedVisitId={historyTarget.visitId} expectedBranchId={historyTarget.branchId} selectedOnly allowChart={false}/></Suspense></section>}
      {feedback&&<p className="chart-feedback" role={feedback.ok?'status':'alert'}>{feedback.message}</p>}
      </>}
      <ConfirmDialog open={reviewOpen} title="Review the saved chart?" confirmLabel="Load saved chart" onCancel={()=>setReviewOpen(false)} onConfirm={()=>{command.current=null;setReviewOpen(false);dirty.current=false;onDirtyChange?.(false);setFeedback(null);setAttempt(a=>a+1)}}><p>This replaces the unsaved finding editor with saved history. A read does not prove an earlier pending command failed. No historical finding is changed or deleted.</p></ConfirmDialog>
    </div>
  )
}

/** Existing authorized Visit API; no Staff/Owner directory access or invented clinic-wide search. */
export function SearchablePatientPicker({selectedPatient,onSelect,store,inputRef}){
  const discoveryGeneration=React.useRef(0)
  const initial=()=>({from:addDays(todayManila(),-30),to:todayManila()})
  const [range,setRange]=useState(initial),[draft,setDraft]=useState(initial),[rangeError,setRangeError]=useState('')
  const applyRange=next=>{const r=discoveryRange(next.from,next.to,todayManila());if(!r.ok){setRangeError(r.message);return}setRangeError('');discoveryGeneration.current++;setResult({loading:true,data:[],error:''});setDraft(next);setRange(next);setAttempt(a=>a+1)}
  const [query,setQuery]=useState(''),[result,setResult]=useState({loading:true,data:[],error:''}),[attempt,setAttempt]=useState(0)
  const reload=()=>{discoveryGeneration.current++;setResult({loading:true,data:[],error:''});setAttempt(a=>a+1)}
  const key=clinicalSessionKey(store?.session),auth=store?.getAuthGeneration?.(),latest=React.useRef(store);latest.current=store
  useEffect(()=>{
    let active=true;const generation=discoveryGeneration.current
    const owns=()=>active&&generation===discoveryGeneration.current&&clinicalSessionKey(latest.current?.session)===key&&latest.current?.getAuthGeneration?.()===auth&&latest.current?.session?.role==='dentist'&&latest.current?.session?.active===true
    setResult({loading:true,data:[],error:''})
    readChartVisitPatients(listVisits,{dentistId:store.session?.dentistId,from:range.from,to:range.to},owns).then(r=>{if(owns())setResult(r.ok?{loading:false,data:r.data,error:''}:{loading:false,data:[],error:r.message||'Your authorized visits could not be loaded. Try again.'})})
    return()=>{active=false}
  },[key,auth,attempt,range.from,range.to])
  const shown=result.data.filter(p=>[p.name,p.code].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className="searchable-patient-picker">
    <div className="chart-read-heading"><div><h3>Find a Patient</h3><p>Your authorized visits in the selected date range.</p></div><RefreshButton title="Reload authorized visits" ariaLabel="Reload authorized visits" loading={result.loading} onClick={reload}/></div>
    {!selectedPatient&&<><FilterBar ariaLabel="Chart discovery filters" onClear={(query||range.from!==initial().from||range.to!==initial().to||draft.from!==range.from||draft.to!==range.to)?()=>{setQuery('');applyRange(initial())}:undefined}><form className="chart-discovery-range" onSubmit={event=>{event.preventDefault();applyRange(draft)}} aria-label="Chart Visit dates"><Field label="From"><input type="date" value={draft.from} max={todayManila()} onChange={e=>setDraft(d=>({...d,from:e.target.value}))}/></Field><Field label="To"><input type="date" value={draft.to} max={todayManila()} onChange={e=>setDraft(d=>({...d,to:e.target.value}))}/></Field><Button type="submit" variant="soft">Apply dates</Button></form></FilterBar><div className="row-actions"><Button variant="ghost" onClick={()=>applyRange(shiftDiscoveryRange(range,-1,todayManila()))}>Older period</Button><span>{range.from} – {range.to}</span><Button variant="ghost" disabled={range.to>=todayManila()} onClick={()=>applyRange(shiftDiscoveryRange(range,1,todayManila()))}>Newer period</Button></div>{rangeError&&<p role="alert">{rangeError}</p>}</>}
    <SearchInput ref={inputRef} value={query} onChange={setQuery} placeholder="Search by Patient name or code…" ariaLabel="Search chart Patients" onClear={query?()=>setQuery(''):undefined}/>
    {selectedPatient?<div className="chart-selected-patient"><p>{selectedPatient.name} · {selectedPatient.code||selectedPatient.patientCode||selectedPatient.id}</p><Button size="sm" variant="ghost" onClick={()=>onSelect(null)}>Change patient</Button></div>:<>
      {result.loading&&<p role="status">Loading authorized visits…</p>}
      {result.error&&<Notice tone="warning">{result.error}<Button variant="ghost" onClick={reload}>Retry authorized visits</Button></Notice>}
      {!result.loading&&!result.error&&!shown.length&&<p>{query?'No matching Patient in these visits.':'No authorized visits were returned for this period.'}</p>}
      {!result.loading&&!result.error&&!!shown.length&&<ul className="patient-picker-list">{shown.map(p=><li key={p.id}><button type="button" onClick={()=>onSelect(p)}><span><b>{p.name}</b><small>{p.code}</small></span><span>Open chart</span></button></li>)}</ul>}
    </>}
  </div>
}

export function DentalChartPage(props) {
  const allowed=useClinicalSession(props.store)
  if(!allowed)return <Notice>Clinical session unavailable. Chart information is hidden.</Notice>
  return <DentistChart key={clinicalSessionKey(props.store.session)+JSON.stringify(props.context||{})} {...props}/>
}
function DentistChart({ store, context, setPage }) {
  const linked=context?.returnEncounter?resolveEncounter(store.state,store.session,context.returnEncounter):null
  if(linked&&!linked.ok)return <Notice title="Chart unavailable">{linked.message}<Button onClick={()=>setPage('queue')}>My Queue</Button></Notice>
  return <DentistChartBody store={store} context={context} setPage={setPage} linked={linked}/>
}
function CompletedEncounterPicker({ patientId, dentistId, value, onChange, disabled }) {
  const [page, setPage] = useState(1), [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  useEffect(() => {
    let active = true
    setResult(null)
    listTreatments({ patient_id: patientId, status: 'Completed', page }).then(response => {
      if (active) setResult(response)
    })
    return () => { active = false }
  }, [patientId, dentistId, page, attempt])
  if (!result) return <p role="status">Loading completed visits…</p>
  if (!result.ok) return <Notice>Completed visits could not be read. <Button onClick={() => setAttempt(n => n + 1)}>Retry</Button></Notice>
  const rows = result.data.filter(r => r.author && r.dentist?.id === dentistId && r.patient?.id === patientId && r.status === 'Completed' && r.visit?.status === 'Completed')
  return <div><Field label="Visit for this chart entry"><select disabled={disabled} value={value?.treatmentId || ''} onChange={e => {
    const row = rows.find(r => r.id === e.target.value)
    onChange(row ? { treatmentId: row.id, revision: row.revision, branchId: row.branch.id, procedures: row.procedures } : null)
  }}><option value="">Finding without a linked visit</option>{rows.map(r => <option key={r.id} value={r.id}>{r.clinic_date} · {r.branch.name} · {r.requested_service?.name || 'Completed visit'} · {r.visit.id.slice(-6)}</option>)}</select></Field>
  {result.meta?.last_page > 1 && <div><Button disabled={disabled || page < 2} onClick={() => { onChange(null); setPage(page - 1) }}>Previous visits</Button><Button disabled={disabled || page >= result.meta.last_page} onClick={() => { onChange(null); setPage(page + 1) }}>More visits</Button></div>}</div>
}

function DentistChartBody({ store, context, setPage, linked }) {
  const toast = store?.toast || (() => {})
  const [selectedPatient, setSelectedPatient] = useState(linked?.patient||null)
  const [chosenEncounter, setChosenEncounter] = useState(null), [editorDirty, setEditorDirty] = useState(false)
  const dirty = React.useRef(false)
  const patientGeneration=React.useRef(0), patientId=React.useRef(selectedPatient?.id||null)
  const pendingTarget=React.useRef(null), patientSearch=React.useRef(null), restoreSearch=React.useRef(false)
  const [topOffset,setTopOffset]=useState(82)
  useEffect(()=>{const top=document.querySelector('.topbar');if(!top||typeof ResizeObserver==='undefined')return;const update=()=>setTopOffset(Math.ceil(top.getBoundingClientRect().height));update();const observer=new ResizeObserver(update);observer.observe(top);return()=>observer.disconnect()},[])
  const generation=patientGeneration.current
  const ownsPatient=()=>patientGeneration.current===generation&&patientId.current===(selectedPatient?.id||null)
  const [pendingPatient, setPendingPatient] = useState(null)
  const cancelPatient=()=>{pendingTarget.current=null;setPendingPatient(null)}
  const applyPatient=patient=>{
    // Invalidate old chart reads, completions and dirty reports before React
    // remounts it, including a rapid A -> B -> A return.
    patientGeneration.current++;patientId.current=patient?.id||null;dirty.current=false
    setChosenEncounter(null); setEditorDirty(false)
    cancelPatient();restoreSearch.current=true;setSelectedPatient(patient)
  }
  const confirmPatient=()=>{
    const target=pendingTarget.current
    if(!target)return
    pendingTarget.current=null
    applyPatient(target.patient)
  }
  const selectPatient = patient => {
    if((patient?.id||null)===patientId.current)return
    if (dirty.current) {const target={patient};pendingTarget.current=target;setPendingPatient(target)}
    else applyPatient(patient)
  }
  React.useLayoutEffect(()=>{
    if(restoreSearch.current){restoreSearch.current=false;patientSearch.current?.focus()}
  },[selectedPatient?.id])
  return <div className="st-page chart-workspace" style={{'--chart-top-offset':`${topOffset}px`}}>
    <ConfirmDialog open={!!pendingPatient} title="Leave this patient's chart?" cancelLabel="Stay" confirmLabel="Discard changes and continue" onCancel={cancelPatient} onConfirm={confirmPatient}>
      <p>Unsaved findings for {selectedPatient?.name} will be discarded. A submitted request keeps its original patient. Unsaved changes are kept only on this screen and cannot be recovered after leaving or reloading.</p>
    </ConfirmDialog>
    <PageHeader kicker="Clinical" title="Dental chart" text="Record findings by tooth and surface. Current findings and earlier entries stay separate. The system makes no diagnosis or suggestion."/>
    {selectedPatient&&<header className="chart-context" aria-label="Current chart Patient and Visit"><h2>{selectedPatient.name}</h2><p>{selectedPatient.patientCode||selectedPatient.code||''}{linked?' · '+(store.state.branches.find(b=>b.id===linked.record.branchId)?.name||linked.record.branchId):''}</p>{linked&&<p>{linked.treatment?.dentistName||store.state.dentists.find(d=>d.id===store.session.dentistId)?.name} · {linked.treatment?.status||linked.visit?.status}</p>}<p className="chart-context-ids">Patient {linked?.record?.patientPublicId||selectedPatient.publicId||selectedPatient.id}{linked&&<> · Visit {linked.visit.id}{linked.treatment&&<> · Encounter {linked.treatment.id} · Revision {linked.treatment.revision}</>}</>}</p>{!linked&&!chosenEncounter&&<p>No encounter is selected. Each finding keeps its recorded branch.</p>}</header>}
    <Card>
      {linked?<><Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button><p>Current findings across visits. New chart entries do not change saved treatment documentation.</p></>:<SearchablePatientPicker selectedPatient={selectedPatient} onSelect={selectPatient} store={store} inputRef={patientSearch}/>}
      {selectedPatient && !linked && <CompletedEncounterPicker key={selectedPatient.id} patientId={selectedPatient.publicId || selectedPatient.id} dentistId={store.session.dentistId} value={chosenEncounter} disabled={editorDirty} onChange={row => { if (!dirty.current) setChosenEncounter(row) }}/>}
      {selectedPatient && <ChartView patientId={linked?.record?.patientPublicId||selectedPatient.publicId||selectedPatient.id} canRecord toast={toast} store={store} recordContext={linked?.treatment?{treatmentId:linked.treatment.id,revision:linked.treatment.revision,branchId:linked.record.branchId,procedures:linked.treatment.status === 'Completed' ? linked.treatment.procedures : []}:chosenEncounter} isCurrent={ownsPatient} onDirtyChange={value => { if(ownsPatient()){dirty.current=value;setEditorDirty(value)} }}/>}
    </Card>
  </div>
}
