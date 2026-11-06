import React, { useEffect, useRef, useState } from 'react'
import { Button, Field } from '../../components.jsx'
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
}) {
  const numbering = data?.settings?.numbering || 'fdi'
  const label = toothLabel(tooth, numbering)
  const fullName = getToothFullName(tooth)
  const statuses = data?.settings?.statuses || []

  // Entries for this tooth
  const history = (data?.history || []).filter(h => h.tooth === tooth)
  const currentEntries = (data?.current || []).filter(c => c.tooth === tooth)
  const allActiveSurfaces = Array.from(new Set(currentEntries.flatMap(c => c.surfaces || [])))
  const current = currentEntries[0] || null

  // Dentist form state
  const [f, setF] = useState({
    status: statuses[0] || '',
    surfaces: [],
    note: '',
    recorded_on: today(),
    branch_id: activeBranchId || (branches.length === 1 ? branches[0]?.id : ''),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const mounted = useRef(true), saving = useRef(false), edits = useRef(0)
  const draftKey = value => JSON.stringify({ ...value, branch_id: String(value.branch_id || '') })
  const form = useRef(f), cleanForm = useRef(draftKey(f))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const ownsEditor = () => mounted.current && isCurrent()
  const changeForm = patch => {
    const next = { ...form.current, ...patch }
    form.current = next; edits.current++; setF(next)
    onDirtyChange?.(draftKey(next) !== cleanForm.current)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!canRecord || !onRecord || saving.current || recordingPending) return
    const revision = edits.current, submitted = form.current
    // Production IDs are legacy refs; a native select also stringifies numeric
    // IDs supplied by internal callers. Recover only that original value type.
    const branch = branches.find(b => String(b.id) === String(submitted.branch_id))?.id ?? submitted.branch_id
    if (typeof branch === 'number' && (!Number.isSafeInteger(branch) || branch <= 0)) {
      setErr('Choose a valid clinic branch.')
      return
    }
    saving.current = true
    setBusy(true); setErr('')
    const payload = { tooth, status: submitted.status, surfaces: [...submitted.surfaces], note: submitted.note.trim() || null, recorded_on: submitted.recorded_on }
    if (submitted.branch_id) {
      if (typeof branch === 'number') payload.branch_id = branch
      else payload.branch_ref = String(submitted.branch_id)
    }
    try {
      const res = await onRecord(payload, ownsEditor)
      if (!ownsEditor() || edits.current !== revision) return
      if (res?.ok) {
        form.current = { ...form.current, surfaces: [], note: '' }
        cleanForm.current = draftKey(form.current)
        setF(x => ({ ...x, surfaces: [], note: '' }))
        onDirtyChange?.(false)
      } else setErr(res?.message || 'Failed to record entry.')
    } catch {
      if (ownsEditor() && edits.current === revision) setErr('The finding could not be confirmed. Check the chart before retrying.')
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

      {/* Surface diagram */}
      <div className="od-surface-section">
        <SurfaceDiagram
          surfaces={canRecord ? f.surfaces : allActiveSurfaces}
          onChange={canRecord ? (surfaces => changeForm({ surfaces })) : undefined}
          readOnly={!canRecord}
          fdi={tooth}
        />
      </div>

      {/* Dentist entry form */}
      {canRecord && (
        <form className="od-record-form au-form" onSubmit={handleSave}>
          <h5 className="od-section-title">Record finding</h5>

          <Field label="Status" required>
            <select
              value={f.status}
              onChange={e => changeForm({ status: e.target.value })}
            >
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

          {recordingPending && !busy && <p role="status">A submitted finding is still saving. You can keep editing this tooth.</p>}
          {err && <p className="au-error" role="alert">{err}</p>}

          <Button type="submit" size="sm" disabled={busy || recordingPending || !f.status}>
            {busy ? 'Saving…' : 'Record finding'}
          </Button>
        </form>
      )}

      {/* History timeline */}
      <div className="od-history-section">
        <h5 className="od-section-title">Timeline & History</h5>
        {history.length === 0 && currentEntries.length === 0 && (
          <p className="od-muted">Nothing recorded yet for this tooth.</p>
        )}
        {history.length > 0 && (
          <div className="od-timeline">
            {history.map(item => (
              <div key={item.id} className="od-timeline-card">
                <div className="od-card-top">
                  <span className="od-card-date">{day(item.recorded_on)}</span>
                  <span className="od-card-badge">{item.status}</span>
                </div>
                {item.surfaces && item.surfaces.length > 0 && (
                  <div className="od-card-surfaces">
                    Surfaces: <b>{item.surfaces.join(' · ')}</b>
                  </div>
                )}
                {item.dentist && (
                  <div className="od-card-dentist">{item.dentist}</div>
                )}
                {item.note && (
                  <div className="od-card-note">{item.note}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {history.length === 0 && currentEntries.length > 0 && (
          <div className="od-timeline">
            {currentEntries.map(item => (
              <div key={item.id} className="od-timeline-card">
                <div className="od-card-top">
                  <span className="od-card-date">{day(item.recorded_on)}</span>
                  <span className="od-card-badge">{item.status}</span>
                </div>
                {item.surfaces && item.surfaces.length > 0 && (
                  <div className="od-card-surfaces">
                    Surfaces: <b>{item.surfaces.join(' · ')}</b>
                  </div>
                )}
                {item.dentist && (
                  <div className="od-card-dentist">{item.dentist}</div>
                )}
                {item.note && (
                  <div className="od-card-note">{item.note}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
