import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, resolveEncounter } from '../encounter.js'
import { ClinicalNavigation } from '../clinical-navigation.jsx'
import React, { useEffect, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, Notice, PageHeader, RefreshButton } from '../components.jsx'
import { patientChart, prescriptionVisits } from '../api-client.js'
import { Odontogram, toothLabel } from '../components/odontogram/index.js'
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
    let current=true,timer;setData(null);setError('');setPicked(null)
    Promise.race([patientChart(patientId),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,message:'The chart read timed out. Retry to review the saved findings.'}),30000)})]).then(r => {
      clearTimeout(timer);if(current&&ownsChart()){if(r.ok&&chartMatches(r.data,patientId))setData(r.data);else setError(r.message || 'The returned chart did not identify this Patient. No chart was adopted.')}
    }).catch(()=>{if(current&&ownsChart())setError('The chart could not be loaded. Retry to read the saved findings.')})
    return()=>{current=false;clearTimeout(timer)}
  }, [patientId,attempt])

  if (error) return <Notice tone="warning" title="Chart unavailable">{error}<Button variant="ghost" onClick={()=>setAttempt(attempt+1)}>Retry chart</Button></Notice>
  if (!data) return <p className="au-muted" role="status">Loading the chart…</p>

  const dentist=store?.state?.dentists?.find(d=>d.id===store?.session?.dentistId)
  const branches = (store?.state?.branches || []).filter(b=>link.current?.branchId?b.id===link.current.branchId:!canRecord||dentist?.branchIds?.includes(b.id))
  const activeBranchId = link.current?.branchId || store?.session?.branchId || null
  const writable=canRecord&&chartReady(data)

  const handleRecord = async (payload, ownsEditor = () => true) => {
    if(!scope.current.canRecord||!chartReady(data)||!ownsChart()||recording.current)return {ok:false,message:'Recording is unavailable or already in progress.'}
    const submittedGeneration=editGeneration.current
    recording.current=true; setRecordingPending(true)
    try {
      const context=link.current?.treatmentId?{treatment_id:link.current.treatmentId,expected_treatment_revision:link.current.revision}:{}
      const submitted={...payload,...context}
      if(command.current?.outcome==='unknown'&&JSON.stringify(command.current.intent)!==JSON.stringify(submitted))return {ok:false,uncertain:true,message:'Retry the original finding on its selected tooth, or review the saved chart before another command.'}
      if(!command.current||command.current.outcome!=='unknown')command.current=beginChartCommand({patientId,payload:submitted,dentistId:store?.session?.dentistId,isCurrent:ownsChart})
      const res = await command.current.submit()
      if(!scope.current.canRecord||!ownsChart())return {ok:false,message:'The chart context changed.'}
      if (res.ok) {
        // Authoritative data belongs to this patient; transient feedback also
        // requires the original tooth selection and edit generation to remain current.
        let current=res.data,needsReview=false,message=''
        if(res.recovered){
          let timer,read
          try{read=await Promise.race([patientChart(patientId),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),30000)})])}catch{read=null}finally{clearTimeout(timer)}
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
    <div className="tc-unified-chart">
      <div className="row-actions"><RefreshButton title="Review saved chart" ariaLabel="Review saved chart" disabled={recordingPending} onClick={()=>{if(dirty.current||command.current?.outcome==='unknown')setReviewOpen(true);else{command.current=null;setAttempt(attempt+1)}}}/></div>
      {canRecord&&!writable&&<Notice tone="warning">Recording is unavailable on this server until the revision and receipt contract is ready. The saved chart remains read-only.</Notice>}
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
      {feedback&&<p role={feedback.ok?'status':'alert'}>{feedback.message}</p>}
      <ConfirmDialog open={reviewOpen} title="Review the saved chart?" confirmLabel="Load saved chart" onCancel={()=>setReviewOpen(false)} onConfirm={()=>{command.current=null;setReviewOpen(false);dirty.current=false;onDirtyChange?.(false);setFeedback(null);setAttempt(attempt+1)}}><p>This replaces the unsaved finding editor with saved history. A read does not prove an earlier pending command failed. No historical finding is changed or deleted.</p></ConfirmDialog>
    </div>
  )
}

/** Dentist: Dental chart page with 100k+ scalable searchable patient picker (Rule 3.4). */
export function SearchablePatientPicker({ selectedPatient, onSelect, store, inputRef }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [recentPatients, setRecentPatients] = useState([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const term = query.trim()
  const searching = term.length >= 2
  const patientsFrom = visits => [...new Map(visits.filter(v => v.patient?.id).map(v => [v.patient.id, v.patient])).values()]

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    if (searching) setResults([])
    const timer = setTimeout(async () => {
      try {
        const response = await prescriptionVisits(searching ? term : '')
        if (!live) return
        if (!response.ok || !Array.isArray(response.data)) {
          setError(['unauthenticated', 'forbidden'].includes(response.kind) ? 'Your session cannot access these visits. Sign in again.' : 'Patient visits could not be loaded.')
        } else {
          (searching ? setResults : setRecentPatients)(patientsFrom(response.data))
        }
      } catch {
        if (live) setError('Patient visits could not be loaded.')
      } finally {
        if (live) setLoading(false)
      }
    }, searching ? 300 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [term, searching, attempt])

  const shown = searching ? results : recentPatients

  return (
    <div className="searchable-patient-picker" style={{ marginBottom: '16px' }}>
      <Field label="Select or search patient" hint="Search patients from your visits by name or patient code.">
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Patient name or code"
            onChange={e => setQuery(e.target.value)}
            style={{ width: '100%', paddingRight: '32px' }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]) }}
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </Field>

      {selectedPatient ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--surface-muted, #f8fafc)', border: '1px solid var(--line)', borderRadius: '8px', marginTop: '8px' }}>
          <div>
            <b style={{ fontSize: '15px' }}>{selectedPatient.name}</b>
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)' }}>
              {selectedPatient.patientCode || selectedPatient.id} {selectedPatient.phone ? `· ${selectedPatient.phone}` : ''}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>Change patient</Button>
        </div>
      ) : (
        <div style={{ marginTop: '8px', maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--surface)' }}>
          {error && <div role="alert" style={{ padding: '12px' }}>{error} <Button size="sm" variant="ghost" onClick={() => setAttempt(n => n + 1)}>Retry</Button></div>}
          {loading && <p role="status" style={{ padding: '12px', margin: 0, color: 'var(--muted)', fontSize: '13px' }}>Searching patient database…</p>}
          {!loading && !error && shown.length === 0 && (
            <p style={{ padding: '12px', margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
              {query.trim().length >= 2 ? 'No patients found matching your search.' : 'Type at least 2 characters to search, or pick from recent visits below.'}
            </p>
          )}
          {!loading && !error && shown.map(p => (
            <button
              type="button"
              key={p.id}
              onClick={() => onSelect(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                width: '100%',
                textAlign: 'left',
                border: 0,
                background: 'transparent',
                color: 'inherit',
                borderBottom: '1px solid var(--line)',
                cursor: 'pointer',
              }}
              className="patient-picker-item"
            >
              <span>
                <b style={{ fontSize: '14px' }}>{p.name}</b>
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)' }}>
                  {p.patientCode || p.id} {p.phone ? `· ${p.phone}` : ''}
                </span>
              </span>
              <span>Open chart</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
  return <div className="st-page">
    <ConfirmDialog open={!!pendingPatient} title="Leave this patient's chart?" cancelLabel="Stay" confirmLabel="Discard changes and continue" onCancel={cancelPatient} onConfirm={confirmPatient}>
      <p>Unsaved findings for {selectedPatient?.name} will be discarded. A submitted request keeps its original patient. Unsaved changes are kept only on this screen and cannot be recovered after leaving or reloading.</p>
    </ConfirmDialog>
    <PageHeader kicker="Clinical" title="Dental chart" text="Record what you find per tooth and surface. Each entry is kept; the latest one is the current chart. The system makes no diagnosis or suggestion."/>
    <Card>
      {linked?<><Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button><h2>{linked.patient.name}</h2><p>This dental chart is separate from the treatment documentation. Unsaved findings are kept only on this screen.</p></>:<SearchablePatientPicker selectedPatient={selectedPatient} onSelect={selectPatient} store={store} inputRef={patientSearch}/>}
      {selectedPatient && <ChartView patientId={linked?.record?.patientPublicId||selectedPatient.publicId||selectedPatient.id} canRecord toast={toast} store={store} recordContext={linked?.treatment?{treatmentId:linked.treatment.id,revision:linked.treatment.revision,branchId:linked.record.branchId}:null} isCurrent={ownsPatient} onDirtyChange={value => { if(ownsPatient())dirty.current=value }}/>}
    </Card>
  </div>
}
