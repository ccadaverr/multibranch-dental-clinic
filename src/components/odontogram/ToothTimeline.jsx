import React, { useEffect, useRef, useState } from 'react'
import { Button, Field } from '../../components.jsx'
import {ToothHistory} from './ToothHistory.jsx'
import '../../history-experience.css'
import { SurfaceDiagram } from './SurfaceDiagram.jsx'
import { getToothFullName, toothLabel } from './toothShapes.js'

const day = d => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

export function ToothTimeline({
  tooth,
  data,
  onBack,
  canRecord = false,
  onRecord,
  branches = [],
  activeBranchId = null,
  isCurrent = () => true,
  onDirtyChange,
  recordingPending = false,
  onReviewEncounter,
}) {
  const numbering = data?.settings?.numbering || 'fdi'
  const label = toothLabel(tooth, numbering)
  const fullName = getToothFullName(tooth)
  const statuses = data?.settings?.statuses || []

  // Entries for this tooth
  const history = (data?.history || []).filter(h => h.tooth === tooth)
  const currentEntries = (data?.current || []).filter(c => c.tooth === tooth)
  const allActiveSurfaces = Array.from(new Set(currentEntries.flatMap(c => c.surfaces || [])))

  // Dentist form state
  const [f, setF] = useState({
    status: '',
    surfaces: [],
    note: '',
    recorded_on: today(),
    branch_id: activeBranchId || (branches.length === 1 ? branches[0]?.id : ''),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [uncertain,setUncertain]=useState(false),[needsReview,setNeedsReview]=useState(false)
  const observed=useRef(data?.tooth_revisions?.[tooth]??0),submittedSave=useRef(null)
  const mounted = useRef(true), saving = useRef(false), edits = useRef(0)
  const draftKey = value => JSON.stringify({ ...value, branch_id: String(value.branch_id || '') })
  const form = useRef(f), cleanForm = useRef(draftKey(f))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const ownsEditor = () => mounted.current && isCurrent()
  const changeForm = patch => {
    if(uncertain||needsReview)return
    const next = { ...form.current, ...patch }
    form.current = next; edits.current++; setF(next)
    onDirtyChange?.(draftKey(next) !== cleanForm.current)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!canRecord || !onRecord || saving.current || recordingPending || needsReview) return
    const submitted = form.current
    // Production IDs are legacy refs; a native select also stringifies numeric
    // IDs supplied by internal callers. Recover only that original value type.
    const branch = branches.find(b => String(b.id) === String(submitted.branch_id))?.id ?? submitted.branch_id
    if (typeof branch === 'number' && (!Number.isSafeInteger(branch) || branch <= 0)) {
      setErr('Choose a valid clinic branch.')
      return
    }
    saving.current = true
    setBusy(true); setErr('')
    let payload = { tooth, status: submitted.status, surfaces: [...submitted.surfaces], note: submitted.note.trim() || null, recorded_on: submitted.recorded_on,expected_revision:observed.current }
    if (submitted.branch_id) {
      if (typeof branch === 'number') payload.branch_id = branch
      else payload.branch_ref = String(submitted.branch_id)
    }
    if(uncertain&&submittedSave.current)payload=submittedSave.current.payload
    else submittedSave.current={payload,edits:edits.current}
    const revision=submittedSave.current.edits
    try {
      const res = await onRecord(payload, ownsEditor)
      if (!ownsEditor()) return
      if (res?.ok) {
        setUncertain(false)
        if(res.needsReview){setNeedsReview(true);setErr(res.message);return}
        if(edits.current!==revision){setNeedsReview(true);setErr('The finding was saved; your newer draft is retained. Review the saved chart before recording that draft.');return}
        if(Number.isSafeInteger(res.revision))observed.current=res.revision
        submittedSave.current=null
        form.current = { ...form.current, status: '', surfaces: [], note: '' }
        cleanForm.current = draftKey(form.current)
        setF(x => ({ ...x, status: '', surfaces: [], note: '' }))
        onDirtyChange?.(false)
      } else {setUncertain(!!res?.uncertain);setNeedsReview(!!res?.needsReview);setErr(res?.message || 'Failed to record entry.')}
    } catch {
      if (ownsEditor()) {setUncertain(true);setErr('The finding could not be confirmed. Check the chart before retrying with different details. Retry the same finding to recover its original result, or review saved history.')}
    } finally {
      saving.current = false
      if (ownsEditor()) setBusy(false)
    }
  }

  return (
    <div className="od-timeline-panel" aria-label={`Details for Tooth ${label}`}>
      {/* Header with back button */}
      <div className="od-panel-nav">
        <button type="button" className="od-back-btn" onClick={onBack} aria-label="Back to all findings">
          ← All findings
        </button>
      </div>

      <div className="od-tooth-hero">
        <div className="od-tooth-chip-wrap">
          <span className="od-tooth-chip">Tooth {label}</span>
          {numbering === 'universal' && <span className="od-sub-chip">FDI {tooth}</span>}
        </div>
        <h4 className="od-tooth-name">{fullName}</h4>
      </div>

      <section className="od-current-findings" aria-label="Current saved findings"><h5 className="od-section-title">Current saved findings</h5>{!currentEntries.length?<p>No finding has been recorded for this tooth.</p>:<ul>{currentEntries.map(e=><li key={e.id}><b>{e.status}</b><p>{!Array.isArray(e.surfaces)?'Surfaces unavailable':e.surfaces.length?'Active surfaces: '+e.surfaces.join(' · '):'Whole tooth'}</p><small>{day(e.recorded_on)}{e.dentist?' · '+e.dentist:''}</small>{e.branch&&<small>{e.branch.name}</small>}</li>)}</ul>}</section>
      <h5 className="od-section-title">{canRecord?'Surfaces for the new finding':'Current saved surfaces'}</h5>
      {/* Surface diagram */}
      <div className="od-surface-section">
        <SurfaceDiagram
          surfaces={canRecord ? f.surfaces : allActiveSurfaces}
          onChange={canRecord ? (surfaces => changeForm({ surfaces })) : undefined}
          readOnly={!canRecord||uncertain||needsReview}
          fdi={tooth}
        />
      </div>

      {/* Dentist entry form */}
      {canRecord && (
        <form className="od-record-form au-form" onSubmit={handleSave}>
          <h5 className="od-section-title">Record finding</h5>

          <fieldset disabled={uncertain||needsReview} style={{border:0,padding:0,margin:0,minWidth:0}}>
          <Field label="Status" required>
            <select
              value={f.status}
              onChange={e => changeForm({ status: e.target.value })}
            >
              <option value="">Choose status…</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          {/* If dentist works at multiple branches, allow choosing branch */}
          {branches.length > 1 && (
            <Field label="Clinic Branch" hint="Branch where this finding was observed">
              <select
                value={f.branch_id}
                onChange={e => changeForm({ branch_id: e.target.value })}
              >
                <option value="">Choose branch…</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </Field>
          )}

          <fieldset className="tc-surfaces">
            <legend>Surfaces (optional)</legend>
            {['M', 'O', 'D', 'B', 'L'].map(s => (
              <label key={s} className="au-check">
                <input
                  type="checkbox"
                  checked={f.surfaces.includes(s)}
                  onChange={e => changeForm({ surfaces: e.target.checked ? [...form.current.surfaces, s] : form.current.surfaces.filter(y => y !== s) })}
                /> {s}
              </label>
            ))}
          </fieldset>

          <p className="od-muted">{f.surfaces.length?'Applies to surfaces '+f.surfaces.join(' · '):'Whole-tooth entry replaces the current tooth state. Earlier entries stay in history.'}</p>
          <Field label="Date">
            <input
              type="date"
              max={today()}
              value={f.recorded_on}
              onChange={e => changeForm({ recorded_on: e.target.value })}
            />
          </Field>

          <Field label="Note (optional)" hint="Visible to dentists only.">
            <textarea
              maxLength={1000}
              placeholder="Add clinical observation or monitoring notes…"
              value={f.note}
              onChange={e => changeForm({ note: e.target.value })}
            />
          </Field>
          </fieldset>

          {recordingPending && !busy && <p role="status">A submitted finding is still saving. You can keep editing this tooth.</p>}
          {err && <p className="au-error" role="alert">{err}</p>}

          <Button type="submit" size="sm" disabled={busy || recordingPending || !f.status || needsReview}>
            {busy ? 'Saving…' : uncertain?'Retry same finding':'Record finding'}
          </Button>
        </form>
      )}

      <ToothHistory history={data?.history===null?null:history} currentEntries={currentEntries} onReviewEncounter={onReviewEncounter}/>
    </div>
  )
}
