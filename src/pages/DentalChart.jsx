import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, resolveEncounter } from '../encounter.js'
import { ClinicalNavigation } from '../clinical-navigation.jsx'
import React, { useEffect, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, Notice, PageHeader } from '../components.jsx'
import { patientChart, prescriptionVisits, recordChartEntry, searchPatients } from '../api-client.js'
import { Odontogram, toothLabel } from '../components/odontogram/index.js'

export { toothLabel } from '../components/odontogram/index.js'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'

/** Unified ChartView (shared between Dentist page, Staff patient record, and drawer) */
export function ChartView(props) {
  return <ChartRecord key={clinicalSessionKey(props.store?.session)+props.patientId} {...props}/>
}
function ChartRecord({ patientId, canRecord, toast, store, onDirtyChange, isCurrent = () => true }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [picked, setPicked] = useState(null), [attempt,setAttempt]=useState(0)
  const live=React.useRef(true), recording=React.useRef(false)
  const dirty=React.useRef(false), editGeneration=React.useRef(0)
  const scope=React.useRef({canRecord,isCurrent})
  scope.current={canRecord,isCurrent}
  const ownsChart=()=>live.current&&scope.current.isCurrent()
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
    let current=true;setData(null);setError('');setPicked(null)
    patientChart(patientId).then(r => {if(current&&ownsChart()){if(r.ok)setData(r.data);else setError(r.message || 'The chart could not be loaded.')}})
    return()=>{current=false}
  }, [patientId,attempt])

  if (error) return <Notice tone="warning" title="Chart unavailable">{error}<Button variant="ghost" onClick={()=>setAttempt(attempt+1)}>Retry chart</Button></Notice>
  if (!data) return <p className="au-muted" role="status">Loading the chart…</p>

  const branches = store?.state?.branches || []
  const activeBranchId = store?.session?.branchId || null

  const handleRecord = async (payload, ownsEditor = () => true) => {
    if(!scope.current.canRecord||!ownsChart()||recording.current)return {ok:false,message:'Recording is unavailable or already in progress.'}
    const submittedGeneration=editGeneration.current
    recording.current=true; setRecordingPending(true)
    try {
      const res = await recordChartEntry(patientId, payload)
      if(!scope.current.canRecord||!ownsChart())return {ok:false,message:'The chart context changed.'}
      if (res.ok) {
        // Authoritative data belongs to this patient; transient feedback also
        // requires the original tooth selection and edit generation to remain current.
        setData(res.data)
        if (ownsEditor()&&editGeneration.current===submittedGeneration) toast?.('Tooth ' + toothLabel(payload.tooth, data.settings?.numbering) + ' recorded.', 'success')
        return { ok: true }
      }
      return { ok: false, message: firstError(res) }
    } catch {
      return { ok: false, message: 'The finding could not be confirmed. Check the chart before retrying.' }
    } finally {
      recording.current=false
      if(ownsChart())setRecordingPending(false)
    }
  }

  return (
    <div className="tc-unified-chart">
      <Odontogram
        data={data}
        selected={picked}
        onSelect={setPicked}
        canRecord={canRecord}
        onRecord={handleRecord}
        branches={branches}
        activeBranchId={activeBranchId}
        recordingPending={recordingPending}
        onDirtyChange={reportDirty}
      />
    </div>
  )
}

/** Dentist: Dental chart page with 100k+ scalable searchable patient picker (Rule 3.4). */
export function SearchablePatientPicker({ selectedPatient, onSelect, store, inputRef }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [recentPatients, setRecentPatients] = useState([])

  useEffect(() => {
    let live=true
    prescriptionVisits().then(r => {
      if(!live)return
      if (r.ok && Array.isArray(r.data)) {
        const unique = [...new Map(r.data.map(v => [v.patient.id, v.patient])).values()]
        setRecentPatients(unique)
      }
    })
    return()=>{live=false}
  }, [])

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let live=true
    const timer = setTimeout(async () => {
      setLoading(true)
      const res = await searchPatients({ search: query.trim(), per_page: 25 })
      if(!live)return
      setLoading(false)
      if (res.ok && Array.isArray(res.data)) {
        setResults(res.data)
      } else {
        setResults([])
      }
    }, 300)
    return () => {live=false;clearTimeout(timer)}
  }, [query])

  const shown = query.trim().length >= 2 ? results : recentPatients

  return (
    <div className="searchable-patient-picker" style={{ marginBottom: '16px' }}>
      <Field label="Select or search patient" hint="Search 100,000+ clinic patients by name, code (PAT-0001), or mobile number">
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search patient by name, patient code, or phone number…"
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
          {loading && <p style={{ padding: '12px', margin: 0, color: 'var(--muted)', fontSize: '13px' }}>Searching patient database…</p>}
          {!loading && shown.length === 0 && (
            <p style={{ padding: '12px', margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
              {query.trim().length >= 2 ? 'No patients found matching your search.' : 'Type at least 2 characters to search, or pick from recent visits below.'}
            </p>
          )}
          {!loading && shown.map(p => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(p)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelect(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: '1px solid var(--line)',
                cursor: 'pointer',
              }}
              className="patient-picker-item"
            >
              <div>
                <b style={{ fontSize: '14px' }}>{p.name}</b>
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)' }}>
                  {p.patientCode || p.id} {p.phone ? `· ${p.phone}` : ''}
                </span>
              </div>
              <Button size="sm" variant="soft">Open Chart</Button>
            </div>
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
      {selectedPatient && <ChartView patientId={selectedPatient.id} canRecord toast={toast} store={store} isCurrent={ownsPatient} onDirtyChange={value => { if(ownsPatient())dirty.current=value }}/>}
    </Card>
  </div>
}
