import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, resolveEncounter } from '../encounter.js'
import { ClinicalNavigation } from '../clinical-navigation.jsx'
import React, { useEffect, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, Notice, PageHeader, RefreshButton, SearchInput } from '../components.jsx'
import { patientChart, listVisits } from '../api-client.js'
import { Odontogram, toothLabel } from '../components/odontogram/index.js'
import {clinicalChartValid,readClinicalChart,readChartVisitPatients} from '../chart-read.js'
import '../chart-experience.css'
import {addDays} from '../clock.js'
import {todayManila} from '../patient/format.js'
import {beginChartCommand,chartMatches,chartReady} from '../chart-command.js'

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
    <div className="tc-unified-chart clinical-odontogram">
      <div className="chart-read-heading"><div><h3>Current dental chart{!canRecord?' · Read-only':''}</h3><p>{data?.patient?.name||'Patient '+patientId}</p></div><RefreshButton title="Review saved chart" ariaLabel="Review saved chart" loading={!data&&!error} disabled={recordingPending} onClick={()=>{if(dirty.current||command.current?.outcome==='unknown')setReviewOpen(true);else{command.current=null;setAttempt(a=>a+1)}}}/></div>
      {error&&<Notice tone="warning" title="Chart unavailable"><p>{error}</p><Button variant="ghost" onClick={()=>setAttempt(a=>a+1)}>Retry chart</Button></Notice>}
      {!data&&!error&&<p className="au-muted" role="status">Loading the chart…</p>}
      {data&&<>
      {canRecord&&!writable&&<Notice tone="warning">Recording is unavailable in this session. Saved findings remain read-only.</Notice>}
      <Odontogram
        data={data}
        selected={picked}
        onSelect={setPicked}
        canRecord={writable}
        onRecord={handleRecord}
        branches={branches}
        activeBranchId={activeBranchId}
        recordingPending={recordingPending}
        onDirtyChange={reportDirty}
      />
      {feedback&&<p className="chart-feedback" role={feedback.ok?'status':'alert'}>{feedback.message}</p>}
      </>}
      <ConfirmDialog open={reviewOpen} title="Review the saved chart?" confirmLabel="Load saved chart" onCancel={()=>setReviewOpen(false)} onConfirm={()=>{command.current=null;setReviewOpen(false);dirty.current=false;onDirtyChange?.(false);setFeedback(null);setAttempt(a=>a+1)}}><p>This replaces the unsaved finding editor with saved history. A read does not prove an earlier pending command failed. No historical finding is changed or deleted.</p></ConfirmDialog>
    </div>
  )
}

/** Existing authorized Visit API; no Staff/Owner directory access or invented clinic-wide search. */
export function SearchablePatientPicker({selectedPatient,onSelect,store,inputRef}){
  const [query,setQuery]=useState(''),[result,setResult]=useState({loading:true,data:[],error:''}),[attempt,setAttempt]=useState(0)
  const key=clinicalSessionKey(store?.session),auth=store?.getAuthGeneration?.(),latest=React.useRef(store);latest.current=store
  useEffect(()=>{
    let active=true
    const owns=()=>active&&clinicalSessionKey(latest.current?.session)===key&&latest.current?.getAuthGeneration?.()===auth&&latest.current?.session?.role==='dentist'&&latest.current?.session?.active===true
    setResult({loading:true,data:[],error:''})
    const today=todayManila()
    readChartVisitPatients(listVisits,{dentistId:store.session?.dentistId,from:addDays(today,-30),to:today},owns).then(r=>{if(owns())setResult(r.ok?{loading:false,data:r.data,error:''}:{loading:false,data:[],error:r.message||'Your authorized visits could not be loaded. Try again.'})})
    return()=>{active=false}
  },[key,auth,attempt])
  const shown=result.data.filter(p=>[p.name,p.code].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className="searchable-patient-picker">
    <div className="chart-read-heading"><div><h3>Find a Patient</h3><p>Your authorized visits from the past 30 days. Open older records from their encounter.</p></div><RefreshButton title="Reload authorized visits" ariaLabel="Reload authorized visits" loading={result.loading} onClick={()=>setAttempt(a=>a+1)}/></div>
    <SearchInput ref={inputRef} value={query} onChange={setQuery} placeholder="Search by Patient name or code…" ariaLabel="Search chart Patients" onClear={query?()=>setQuery(''):undefined}/>
    {selectedPatient?<div className="chart-selected-patient"><p>{selectedPatient.name} · {selectedPatient.code||selectedPatient.patientCode||selectedPatient.id}</p><Button size="sm" variant="ghost" onClick={()=>onSelect(null)}>Change patient</Button></div>:<>
      {result.loading&&<p role="status">Loading authorized visits…</p>}
      {result.error&&<Notice tone="warning">{result.error}<Button variant="ghost" onClick={()=>setAttempt(a=>a+1)}>Retry authorized visits</Button></Notice>}
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
function DentistChartBody({ store, context, setPage, linked }) {
  const toast = store?.toast || (() => {})
  const [selectedPatient, setSelectedPatient] = useState(linked?.patient||null)
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
    {selectedPatient&&<header className="chart-context" aria-label="Current chart Patient and Visit"><h2>{selectedPatient.name}</h2><p>{selectedPatient.patientCode||selectedPatient.code||''}{linked?' · '+(store.state.branches.find(b=>b.id===linked.record.branchId)?.name||linked.record.branchId):''}</p>{linked&&<p>{linked.treatment?.dentistName||store.state.dentists.find(d=>d.id===store.session.dentistId)?.name} · {linked.treatment?.status||linked.visit?.status}</p>}<p className="chart-context-ids">Patient {linked?.record?.patientPublicId||selectedPatient.publicId||selectedPatient.id}{linked&&<> · Visit {linked.visit.id}{linked.treatment&&<> · Encounter {linked.treatment.id} · Revision {linked.treatment.revision}</>}</>}</p>{!linked&&<p>No encounter is selected. Each finding keeps its recorded branch.</p>}</header>}
    <Card>
      {linked?<><Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button><p>Current findings across visits. New chart entries do not change saved treatment documentation.</p></>:<SearchablePatientPicker selectedPatient={selectedPatient} onSelect={selectPatient} store={store} inputRef={patientSearch}/>}
      {selectedPatient && <ChartView patientId={linked?.record?.patientPublicId||selectedPatient.publicId||selectedPatient.id} canRecord toast={toast} store={store} recordContext={linked?.treatment?{treatmentId:linked.treatment.id,revision:linked.treatment.revision,branchId:linked.record.branchId}:null} isCurrent={ownsPatient} onDirtyChange={value => { if(ownsPatient())dirty.current=value }}/>}
    </Card>
  </div>
}
