import { useClinicalSession } from '../use-clinical-session.js'
import { useClinicalProtection } from '../clinical-navigation.jsx'
import { clinicalSessionKey, resolveEncounter } from '../encounter.js'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterBar, Modal, Notice, PageHeader } from '../components.jsx'
import { createPrescription, downloadPrescriptionPdf, issuePrescription, listPrescriptions, prescription, prescriptionVisits, savePrescriptionLicense, updatePrescription, voidPrescription } from '../api-client.js'
import '../dentist-clinical.css'

const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work.'
const day = d => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
const EMPTY_LINE = { medicine: '', dosage: '', frequency: '', duration: '', instructions: '' }
const OTHER_OPTION = '__other__'
const LINE_FIELDS = Object.keys(EMPTY_LINE)
const CUSTOM_FIELDS = ['medicine', 'dosage', 'frequency', 'duration']
const selectedOption = (line, field, catalog) => line[`${field}Other`] || (line[field] && !catalog.includes(line[field])) ? OTHER_OPTION : line[field]
const chooseOption = (line, field, option) => ({ ...line, [field]: option === OTHER_OPTION ? '' : option, [`${field}Other`]: option === OTHER_OPTION })
const apiLine = line => Object.fromEntries(LINE_FIELDS.map(field => [field, line[field]]))
const draftSnapshot = ({lines, note}) => JSON.stringify({lines: lines.map(line => ({
  ...Object.fromEntries(LINE_FIELDS.map(field => [field, line[field] ?? ''])),
  ...Object.fromEntries(CUSTOM_FIELDS.map(field => [`${field}Other`, !!line[`${field}Other`]])),
})), note})
const TONE = { Draft: 'is-late', Issued: 'is-ok', Void: 'is-bad' }

// Medicine name autocomplete list only. Dosing, frequency, duration, and instructions are never pre-filled or presented as clinic-approved defaults.
const COMMON_MEDICINE_NAMES = [
  'Amoxicillin',
  'Mefenamic Acid',
  'Paracetamol',
  'Ibuprofen',
  'Co-amoxiclav',
  'Clindamycin',
  'Tranexamic Acid',
  'Celecoxib',
  'Chlorhexidine Oral Rinse',
]
const COMMON_DOSAGES = ['250mg', '500mg', '625mg', '1000mg (1g)', '15ml', '1 tablet', '1 capsule', '2 tablets']
const COMMON_FREQUENCIES = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Before meals', 'After meals', 'As needed for pain']
const COMMON_DURATIONS = ['3 days', '5 days', '7 days', '10 days', '14 days', 'As needed for 5 days']

/**
 * M19 Prescriptions (clinic server). Dentists at the branch write a prescription for a recent visit: free-text lines, no drug list
 * and no interaction checks (the Owner may keep common names for quick selection), then issue it, which locks it and numbers it.
 * A mistake is voided with a reason and a new one is issued. The front desk views and prints issued ones; the Owner sees
 * metadata only.
 */
export function PrescriptionsServerPage(props) {
  const allowed=useClinicalSession(props.store)
  if(props.role==='dentist'&&!allowed)return <Notice>Clinical session unavailable. Prescription information is hidden.</Notice>
  const linked=props.context?.returnEncounter?resolveEncounter(props.store.state,props.store.session,props.context.returnEncounter):null
  if(linked&&!linked.ok)return <Notice>{linked.message}<Button onClick={()=>props.setPage('queue')}>My Queue</Button></Notice>
  return <PrescriptionsBody key={JSON.stringify([clinicalSessionKey(props.store.session), props.store.getAuthGeneration?.(), props.context?.visitId||'all'])} {...props}/>
}
function PrescriptionsBody({ store, role, context, setPage }) {
  const toast = store?.toast || (() => {})
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [openId, setOpenId] = useState(null), [writing, setWriting] = useState(null)
  const [query, setQuery] = useState(''), [statusFilter, setStatusFilter] = useState('all')
  // Invalidate UI completions synchronously when selection changes. The server
  // command still finishes for its original prescription, even after unmount.
  const editorGeneration = useRef(0)
  const editorLeave = useRef(null)
  const generation = editorGeneration.current
  const applyDraft = id => {
    if(id===writing)return
    editorGeneration.current++
    setWriting(id)
  }
  const selectDraft = (id, closeDetail = false) => {
    if (id === writing) { if (closeDetail) setOpenId(null); return }
    const change = () => { if (closeDetail) setOpenId(null); applyDraft(id) }
    if (editorLeave.current) editorLeave.current(change)
    else change()
  }
  const load = () => listPrescriptions().then(r => { if (r.ok) { setRows(r.data); setError('') } else setError(r.message || 'Prescriptions could not be loaded.') })
  useEffect(() => { load() }, [])
  const dentist = role === 'dentist', owner = role === 'owner'
  const filteredRows = (rows || []).filter(p => {
    if(context?.visitId&&(p.visit!==context.visitId||p.patient?.id!==(context.patientPublicId||context.patientId)))return false
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      (p.number || '').toLowerCase().includes(q) ||
      (p.patient?.name || '').toLowerCase().includes(q) ||
      (p.dentist || '').toLowerCase().includes(q) ||
      (p.branch || '').toLowerCase().includes(q)
    )
  })
  return <div className="st-page dentist-prescriptions">
    {context?.returnEncounter&&<Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button>}
    {context?.visitId&&<Notice>Prescriptions for this encounter. A Draft has not been issued.</Notice>}
    <PageHeader kicker={owner ? 'Administration' : 'Clinical'} title="Prescriptions"
      text={owner ? 'Prescriptions issued at the clinic: number, date, dentist and branch. The medicines are visible only to the dentists, the branch front desk and the patient.'
        : dentist ? 'Write a prescription for a recent visit. Issuing locks it; a mistake is voided with a reason and a new one is issued. There is no drug list and no interaction check: you decide what to prescribe.'
          : 'Prescriptions issued at your branch, to view and print. Only a dentist writes or changes them.'}/>
    {dentist && <WriteCard key={writing || 'new'} getAuthGeneration={store.getAuthGeneration} context={context} toast={toast} onDone={id => { load(); setOpenId(id) }} editing={writing} onEdited={() => applyDraft(null)} leaveRef={editorLeave} isCurrent={() => editorGeneration.current===generation}/>}
    {dentist && <LicenseCard toast={toast}/>}
    {error && <Notice tone="warning" title="Unavailable">{error}</Notice>}
    <Card title={owner ? 'Issued prescriptions' : 'Prescriptions'}>
      {rows && rows.length > 0 && (
        <FilterBar
          className="st-filters"
          ariaLabel="Filter prescriptions"
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search by number, patient, dentist, or branch…"
          onClear={(query || statusFilter !== 'all') ? () => { setQuery(''); setStatusFilter('all') } : null}
        >
          <Field label="Status">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="Issued">Issued</option>
              <option value="Draft">Draft</option>
              <option value="Void">Void</option>
            </select>
          </Field>
        </FilterBar>
      )}
      {!rows ? <p className="au-muted" role="status">Loading…</p> : !filteredRows.length ? <p className="au-muted">No prescriptions found.</p>
        : <ul className="fd-list">{filteredRows.map(p => <li key={p.id}>
          <div><b>{p.number || 'Draft'}{p.patient ? ` · ${p.patient.name}` : ''}</b>
            <span><span className={`fd-badge ${TONE[p.status]}`}>{p.status === 'Void' ? 'VOID' : p.status}</span> · {p.date ? day(p.date) : 'not issued'} · {p.dentist} · {p.branch}</span></div>
          <div className="ns-actions">
            {p.can_edit && <Button size="sm" variant="soft" onClick={() => selectDraft(p.id)}>Edit draft</Button>}
            <Button size="sm" variant={owner ? 'soft' : 'ghost'} onClick={() => setOpenId(p.id)}>{owner ? 'View record' : 'Open'}</Button>
          </div>
        </li>)}</ul>}
    </Card>
    {openId && <PrescriptionDialog id={openId} getAuthGeneration={store.getAuthGeneration} toast={toast} onClose={() => setOpenId(null)} onChanged={load} onEdit={dentist ? id => selectDraft(id, true) : undefined}/>}
  </div>
}

function WriteCard({ toast, onDone, editing, onEdited, context, isCurrent, leaveRef, getAuthGeneration }) {
  const mounted=useRef(true)
  const visitGeneration=useRef(0)
  const saving=useRef(null), pendingLeave=useRef(null), pendingCompletion=useRef(null)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const [visits, setVisits] = useState(null), [meta, setMeta] = useState({}), [visitId, setVisitId] = useState(context?.visitId||'')
  const [lines, renderLines] = useState([{ ...EMPTY_LINE }]), [note, renderNote] = useState(''), [draft, setDraft] = useState(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(''), [confirmIssue, setConfirmIssue] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [visitError, setVisitError] = useState(''), [visitAttempt, setVisitAttempt] = useState(0)
  const form = useRef({lines, note}), cleanForm = useRef(draftSnapshot(form.current))
  useClinicalProtection(draftSnapshot(form.current) !== cleanForm.current, !!busy)
  const replaceForm = (nextLines, nextNote) => {
    form.current = {lines: nextLines, note: nextNote}
    cleanForm.current = draftSnapshot(form.current)
    renderLines(nextLines); renderNote(nextNote)
  }
  // Lock only this editor's submitted version, not the Visit selector or other
  // draft selectors. Synchronous guards also reject same-tick duplicate submits.
  const setLines = update => {
    if (saving.current) return
    const next = typeof update === 'function' ? update(form.current.lines) : update
    form.current = {...form.current, lines: next}; renderLines(next)
  }
  const setNote = value => {
    if (saving.current) return
    form.current = {...form.current, note: value}; renderNote(value)
  }
  const requestLeave = action => {
    if (draftSnapshot(form.current) === cleanForm.current) return action()
    pendingLeave.current = action; setLeaving(true)
  }
  useLayoutEffect(() => {
    leaveRef.current = requestLeave
    return () => { if (leaveRef.current === requestLeave) leaveRef.current = null }
  }, [leaveRef])
  const stay = () => {
    pendingLeave.current = null; setLeaving(false)
    const complete = pendingCompletion.current; pendingCompletion.current = null
    complete?.()
  }
  const discard = () => {
    const action = pendingLeave.current
    // Consume before React commits. A late result must not replace this choice.
    pendingLeave.current = null; pendingCompletion.current = null; setLeaving(false)
    action?.()
  }
  useEffect(() => {
    let live = true
    setVisitError(''); setVisits(null)
    const loadVisits = async () => {
      let r
      try { r = await prescriptionVisits() }
      catch { r = {ok: false, message: 'Visits could not be loaded. Try again.'} }
      if (!live) return
      if (!r.ok) { setVisitError(firstError(r)); return }
      setVisits(context?.visitId ? r.data.filter(v => v.id === context.visitId && v.patient?.id === (context.patientPublicId || context.patientId)) : r.data)
      setMeta(r.meta || {})
    }
    loadVisits()
    return () => { live = false }
  }, [visitAttempt])
  useEffect(() => {
    if (!editing) return
    let live=true
    prescription(editing).then(r => {
      if(!live)return
      if (r.ok && r.data.id===editing && r.data.status==='Draft' && r.data.can_edit) { setDraft(r.data); setVisitId(r.data.visit); replaceForm(r.data.lines.map(l => ({ ...EMPTY_LINE, ...l })), r.data.note || '') }
      else setErr(r.ok ? 'This prescription is no longer an editable draft.' : firstError(r))
    })
    return()=>{live=false}
  }, [editing])
  const visit = (visits || []).find(v => v.id === visitId)
  const set = (i, k, v, custom = false) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v, ...(custom ? { [`${k}Other`]: true } : {}) } : l))
  const choose = (i, field, option) => setLines(ls => ls.map((l, j) => j === i ? chooseOption(l, field, option) : l))
  const missingCustomValue = lines.some(line => CUSTOM_FIELDS.some(field => line[`${field}Other`] && !line[field].trim()))
  const changeVisit = id => {
    if (id === visitId) return
    requestLeave(() => {
      // A new selection starts a blank editor. Invalidate synchronously, including
      // A -> B -> A; comparing only the Visit ID would revive A's old completion.
      visitGeneration.current++
      saving.current = null
      setVisitId(id); replaceForm([{ ...EMPTY_LINE }], ''); setErr(''); setBusy(''); setConfirmIssue(false)
    })
  }
  const reset = () => { visitGeneration.current++; saving.current = null; setDraft(null); setVisitId(''); replaceForm([{ ...EMPTY_LINE }], ''); onEdited() }
  const save = async issue => {
    if (saving.current) return
    if (missingCustomValue) return setErr('Specify the selected Other values before saving.')
    const authGeneration = getAuthGeneration?.()
    if (issue && !Number.isSafeInteger(authGeneration)) return setErr('Your authentication could not be confirmed. Sign in again before issuing. No issuance was started.')
    const generation=visitGeneration.current
    const request = {generation, authGeneration}
    saving.current = request
    setBusy(issue ? 'issue' : 'save'); setErr('')
    const body = { lines: lines.filter(l => l.medicine.trim()).map(apiLine), note: note.trim() || null }
    let r, savedDraft
    try {
      r = draft ? await updatePrescription(draft.id, { ...body, expected_revision: draft.revision }) : await createPrescription({ visit_id: visitId, ...body })
      if (r.ok && issue) {
        savedDraft = r.data
        // Only authentication continuity gates the next command. Visit/editor
        // changes and page unmount do not revoke confirmed original-Visit intent.
        if (getAuthGeneration() !== request.authGeneration) {
          r = {ok: false, kind: 'auth_changed', message: 'The Draft was saved. Issuance was not started because your session changed. Review the Draft after signing in.'}
        } else r = await issuePrescription(savedDraft.id, savedDraft.revision)
      }
    } catch {
      r = {ok: false, message: 'The prescription result could not be confirmed. Check the prescription list before retrying.'}
    }
    // A transmitted Save/explicit Issue retains its original identity. Only its
    // current editor may consume the result, report feedback or navigate.
    const complete = () => {
      if(!mounted.current||!isCurrent()||visitGeneration.current!==generation||saving.current!==request)return
      if (getAuthGeneration && getAuthGeneration() !== request.authGeneration) return
      saving.current = null; setBusy('')
      if (!r.ok) {
        // A confirmed create/update followed by failed Issue is still a saved
        // Draft. Retain its ID/revision so an explicit retry cannot create a copy.
        if (savedDraft?.status === 'Draft' && savedDraft.can_edit) { setDraft(savedDraft); cleanForm.current = draftSnapshot(form.current) }
        return setErr(firstError(r))
      }
      toast(issue ? `Issued ${r.data.number}. Patient notification delivery is not confirmed.` : 'Draft saved. Only dentists at this branch can see it.', 'success')
      reset(); onDone(r.data.id)
    }
    if(!mounted.current||!isCurrent()||visitGeneration.current!==generation||saving.current!==request)return
    if (pendingLeave.current) pendingCompletion.current = complete
    else complete()
  }
  if(editing&&!draft)return <Card title="Open prescription draft">{err?<Notice tone="warning" title="Draft unavailable">{err}</Notice>:<p role="status">Loading prescription draft…</p>}<Button variant="ghost" onClick={onEdited}>Cancel</Button></Card>
  return <Card title={draft ? `Edit draft for ${draft.patient?.name}` : 'Write a prescription'}>
    <ConfirmDialog open={leaving} title="Leave this prescription?" cancelLabel="Stay" confirmLabel="Discard changes and continue" onCancel={stay} onConfirm={discard}>
      <p>Unsaved medicines and notes for {draft?.patient?.name || visit?.patient.name || 'this prescription'} will be discarded. A submitted request continues for its original Visit; its result is shown here only if you stay.</p>
    </ConfirmDialog>
    {visitError ? <Notice tone="warning" title="Visits unavailable"><p role="alert">{visitError}</p><Button variant="soft" onClick={() => setVisitAttempt(a => a + 1)}>Retry loading visits</Button></Notice> : !visits ? <p className="au-muted" role="status">Loading visits…</p> : <form className="au-form" onSubmit={e => { e.preventDefault(); save(false) }}>
      {!visits.length && <p role="status">No eligible visits found.</p>}
      {!draft && <Field label="Visit" required hint="Visits at your branches in the last 30 days."><select value={visitId} onChange={e => changeVisit(e.target.value)} required>
        <option value="">Choose a visit…</option>{visits.map(v => <option key={v.id} value={v.id}>{day(v.date)} · {v.patient.name}{v.patient.age !== null ? ` (${v.patient.age})` : ''} · {v.branch}</option>)}</select></Field>}
      {(visit || draft) && <Notice tone="warning" title="Check allergies before prescribing">{meta.allergies?.length ? meta.allergies.join(', ') : meta.allergy_notice}</Notice>}
      <datalist id="rx-common">{[...new Set([...(meta.common_medicines || []), ...COMMON_MEDICINE_NAMES])].map(m => <option key={m} value={m}/>)}</datalist>
      {lines.map((l, i) => {
        const medicineCatalog = [...new Set([...(meta.common_medicines || []), ...COMMON_MEDICINE_NAMES])]
        const medSelect = selectedOption(l, 'medicine', medicineCatalog)
        const dosageSelect = selectedOption(l, 'dosage', COMMON_DOSAGES)
        const freqSelect = selectedOption(l, 'frequency', COMMON_FREQUENCIES)
        const durationSelect = selectedOption(l, 'duration', COMMON_DURATIONS)

        return <fieldset key={i} className="rx-line" disabled={!!busy}><legend>Medicine {i + 1}</legend>
          <Field label="Medicine" required hint="Choose standard medicine or Other to specify">
            <select
              aria-label={`Select medicine ${i + 1}`}
              value={medSelect}
              onChange={e => {
                const val = e.target.value
                choose(i, 'medicine', val)
              }}
            >
              <option value="">Choose medicine…</option>
              {medicineCatalog.map(name => <option key={name} value={name}>{name}</option>)}
              <option value="__other__">Other (free-text entry)</option>
            </select>
          </Field>
          {medSelect === '__other__' && (
            <Field label="Specify medicine name" required>
              <input value={l.medicine} maxLength={200} onChange={e => set(i, 'medicine', e.target.value, true)} placeholder="Type medicine name (e.g. Ciprofloxacin)"/>
            </Field>
          )}

          <div className="st-pair">
            <Field label="Dosage" hint="Choose standard dosage or Other">
              <select
                aria-label={`Select dosage ${i + 1}`}
                value={dosageSelect}
                onChange={e => {
                  const val = e.target.value
                  choose(i, 'dosage', val)
                }}
              >
                <option value="">Choose dosage…</option>
                {COMMON_DOSAGES.map(d => <option key={d} value={d}>{d}</option>)}
                <option value="__other__">Other (specify)</option>
              </select>
            </Field>
            <Field label="Frequency" hint="Choose standard frequency or Other">
              <select
                aria-label={`Select frequency ${i + 1}`}
                value={freqSelect}
                onChange={e => {
                  const val = e.target.value
                  choose(i, 'frequency', val)
                }}
              >
                <option value="">Choose frequency…</option>
                {COMMON_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                <option value="__other__">Other (specify)</option>
              </select>
            </Field>
          </div>

          <div className="st-pair">
            {dosageSelect === '__other__' && (
              <Field label="Specify custom dosage" required>
                <input value={l.dosage} maxLength={120} onChange={e => set(i, 'dosage', e.target.value, true)} placeholder="e.g. 750mg twice daily"/>
              </Field>
            )}
            {freqSelect === '__other__' && (
              <Field label="Specify custom frequency" required>
                <input value={l.frequency} maxLength={120} onChange={e => set(i, 'frequency', e.target.value, true)} placeholder="e.g. Every 4 hours"/>
              </Field>
            )}
          </div>

          <Field label="Duration" hint="Choose standard treatment duration or Other">
            <select
              aria-label={`Select duration ${i + 1}`}
              value={durationSelect}
              onChange={e => {
                const val = e.target.value
                choose(i, 'duration', val)
              }}
            >
              <option value="">Choose duration…</option>
              {COMMON_DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              <option value="__other__">Other (specify)</option>
            </select>
          </Field>
          {durationSelect === '__other__' && (
            <Field label="Specify custom duration" required>
              <input value={l.duration} maxLength={120} onChange={e => set(i, 'duration', e.target.value, true)} placeholder="e.g. 10 days or until finished"/>
            </Field>
          )}

          <Field label="Instructions (optional)"><textarea value={l.instructions} maxLength={500} onChange={e => set(i, 'instructions', e.target.value)} placeholder="e.g. Take with full glass of water after meals"/></Field>
          {lines.length > 1 && <Button size="sm" variant="danger" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove medicine {i + 1}</Button>}
        </fieldset>
      })}
      <Button size="sm" variant="soft" disabled={!!busy} onClick={() => setLines(ls => [...ls, { ...EMPTY_LINE }])}>Add another medicine</Button>
      <Field label="Note (optional)"><textarea value={note} maxLength={1000} disabled={!!busy} onChange={e => setNote(e.target.value)}/></Field>
      {busy && <p role="status">The submitted medicines and notes are locked while the request is pending. You can still choose another Visit or draft; unsaved work requires confirmation.</p>}
      {err && <p className="au-error" role="alert">{err}</p>}
      <div className="ns-actions">
        <Button type="submit" variant="soft" disabled={!!busy || (!draft && !visitId) || missingCustomValue || !lines.some(l => l.medicine.trim())}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
        <Button disabled={!!busy || (!draft && !visitId) || missingCustomValue || !lines.some(l => l.medicine.trim())} onClick={() => setConfirmIssue(true)}>{busy === 'issue' ? 'Issuing…' : 'Issue prescription'}</Button>
        {draft && <Button variant="ghost" onClick={() => requestLeave(reset)}>Cancel</Button>}
      </div>
      <p className="au-muted">Issuing locks the prescription and gives it a number. It cannot be edited afterwards, only voided.</p>
      <ConfirmDialog
        open={confirmIssue}
        title="Issue and lock prescription?"
        tone="default"
        confirmLabel="Issue prescription"
        onConfirm={() => { setConfirmIssue(false); save(true) }}
        onCancel={() => setConfirmIssue(false)}
      >
        <p>Issuing assigns an official prescription number, locks the medication lines against further edits, and makes the prescription available to the branch front desk and the patient.</p>
      </ConfirmDialog>
    </form>}
  </Card>
}

function LicenseCard({ toast }) {
  const [value, setValue] = useState(null), [busy, setBusy] = useState(false)
  useEffect(() => { prescriptionVisits().then(r => r.ok && setValue(r.meta?.license_no || '')) }, [])
  if (value === null) return null
  return <Card title="License number on my prescriptions" subtitle="Optional. Shown under your name on prescriptions you issue from now on. Never filled in for you.">
    <form className="au-form rx-license-row" onSubmit={async e => { e.preventDefault(); setBusy(true); const r = await savePrescriptionLicense(value.trim() || null); setBusy(false); toast(r.ok ? 'Saved.' : firstError(r), r.ok ? 'success' : 'warning') }}>
      <Field label="License number"><input value={value} maxLength={40} onChange={e => setValue(e.target.value)}/></Field>
      <div className="au-actions"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </form>
  </Card>
}

// Void operations survive dialog remounts within the existing provider lifetime.
// These are client continuity guards, not server session/operation receipts.
const rxVoidLedgers = new WeakMap()
function rxVoidLedger(read, generation) {
  if (typeof read !== 'function' || !Number.isSafeInteger(generation)) return null
  let ledger = rxVoidLedgers.get(read)
  if (!ledger || ledger.generation !== generation) {
    ledger = {generation, operations: new Map(), known: new Map(), version: 0}
    rxVoidLedgers.set(read, ledger)
  }
  return ledger
}
const rxRecordValid = (p, id) => p?.id === id && Object.hasOwn(TONE, p.status) && Number.isSafeInteger(p.revision) && p.revision > 0
const rxSamePrescription = (p, original) => p?.id === original.id && p.patient?.id === original.patientId && p.visit === original.visit && p.number === original.number
const rxSnapshotCurrent = (p, known) => !known || p.revision >= known.revision &&
  (p.revision !== known.revision || p.status === known.status) && (known.status !== 'Void' || p.status === 'Void') &&
  p.patient?.id === known.patientId && p.visit === known.visit && p.number === known.number
const rxVoidState = (p, original) => rxSamePrescription(p, original) && p.status === 'Void' &&
  Number.isSafeInteger(p.revision) && p.revision > original.revision && p.can_void === false &&
  typeof p.voided?.at === 'string' && typeof p.voided.reason === 'string'
const rxVoidUncertain = r => !r || r.ok !== false || !r.kind || ['network', 'server'].includes(r.kind)
const rxRemember = (ledger, p) => ledger?.known.set(p.id, {revision: p.revision, status: p.status, patientId: p.patient?.id, visit: p.visit, number: p.number})

export function PrescriptionDialog(props) {
  const selection = useRef(null), next = useRef(0)
  const generation = props.getAuthGeneration?.()
  if (!selection.current || selection.current.id !== props.id || selection.current.reader !== props.getAuthGeneration || selection.current.generation !== generation) {
    selection.current = {id: props.id, reader: props.getAuthGeneration, generation, key: ++next.current, closed: false}
  }
  const scope = selection.current
  const isCurrent = () => selection.current === scope && !scope.closed &&
    (!scope.reader || Number.isSafeInteger(scope.generation) && scope.reader() === scope.generation)
  const dismiss = () => {
    if (selection.current !== scope || scope.closed) return
    scope.closed = true // Close/Escape invalidates callbacks before React cleanup.
    props.onClose?.()
  }
  const ledger = rxVoidLedger(scope.reader, scope.generation)
  return <PrescriptionDialogBody {...props} key={scope.key} ledger={ledger} isCurrent={isCurrent} onClose={dismiss}/>
}
function PrescriptionDialogBody({ id, toast, onClose, onChanged, onEdit, ledger, isCurrent }) {
  const mounted = useRef(false), serial = useRef(0), pending = useRef(null)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++ } }, [])
  const owns = () => mounted.current && isCurrent()
  const [p, setP] = useState(null), [error, setError] = useState(''), [reason, setReason] = useState(''), [voiding, setVoiding] = useState(false), [busy, setBusy] = useState(false)
  const [voidError, setVoidError] = useState('')
  const operation = ledger?.operations.get(id), observedPending = operation?.phase === 'pending'
  const protectedVoid = busy || !!operation
  const reload = async () => {
    if (!owns()) return false
    const attempt = ++serial.current, version = ledger?.version
    setP(null); setError('')
    let r
    try { r = await prescription(id) }
    catch { r = {ok: false, message: 'This prescription could not be confirmed. Reload it before continuing.'} }
    if (!owns() || serial.current !== attempt) return false
    if (ledger && ledger.version !== version) { setError('The Void result settled after this read began. Reload the prescription again.'); return false }
    const outstanding = ledger?.operations.get(id)
    if (!r?.ok || !rxRecordValid(r.data, id) || !rxSnapshotCurrent(r.data, ledger?.known.get(id)) || outstanding && !rxSamePrescription(r.data, outstanding.submitted)) {
      setError(r?.ok ? 'The prescription response did not match this record or its verified state. Reload it before continuing.' : r?.message || 'This prescription could not be opened.')
      return false
    }
    rxRemember(ledger, r.data)
    const reconciled = outstanding && outstanding.phase !== 'pending' && rxVoidState(r.data, outstanding.submitted)
    if (reconciled) ledger.operations.delete(id)
    setP(r.data); setVoidError('')
    if (r.data.status !== 'Issued' || r.data.can_void !== true) setVoiding(false)
    if (reconciled) onChanged?.()
    return true
  }
  useEffect(() => { reload() }, [])
  useEffect(() => {
    // Capture pending at render, since settlement may precede passive effects.
    if (!operation || operation.owner === pending || !observedPending) return
    let current = true
    operation.promise.then(() => { if (current && owns()) reload() })
    return () => { current = false }
  }, [operation])
  const doVoid = async () => {
    if (!owns() || pending.current || ledger?.operations.has(id)) return
    if (!ledger) return setVoidError('Your authentication could not be confirmed. Sign in again before voiding. No Void request was started.')
    if (!p || p.id !== id || p.status !== 'Issued' || p.can_void !== true || !p.patient?.id || !p.visit || !rxSnapshotCurrent(p, ledger.known.get(id))) return setVoidError('This prescription is not confirmed as eligible for voiding. Reload it before continuing.')
    if (reason.trim().length < 3 || reason.trim().length > 300) return setVoidError('Enter a reason between 3 and 300 characters.')
    const submitted = {id, reason: reason.trim(), revision: p.revision, patientId: p.patient.id, visit: p.visit, number: p.number}
    const request = {submitted, owner: pending, token: {}, phase: 'pending'}
    pending.current = request; ledger.operations.set(id, request); setBusy(true); setVoidError('')
    request.promise = (async () => {
      let r
      try { r = await voidPrescription(id, reason.trim()) }
      catch { r = {ok: false, kind: 'network'} }
      if (ledger.operations.get(id)?.token === request.token) {
        ledger.version++
        const confirmed = r?.ok === true && rxVoidState(r.data, submitted) && r.data.voided.reason === submitted.reason && rxSnapshotCurrent(r.data, ledger.known.get(id))
        request.phase = confirmed ? 'confirmed' : rxVoidUncertain(r) ? 'recovery' : 'refused'
        if (confirmed) rxRemember(ledger, r.data)
        if (request.phase === 'refused') ledger.operations.delete(id)
      }
      return r
    })()
    const r = await request.promise
    if (!owns()) return
    pending.current = null; setBusy(false)
    if (request.phase !== 'confirmed') return setVoidError(request.phase === 'recovery'
      ? 'The Void result could not be confirmed. Reload before continuing; an unchanged Issued record does not prove that the request failed.'
      : firstError(r))
    setP(r.data); setVoiding(false); toast?.('Voided. Write a new prescription if one is still needed.', 'success'); onChanged?.()
  }
  return <Modal open title={p ? `${p.number || 'Draft'}${p.patient ? ` · ${p.patient.name}` : ''}` : 'Prescription'} onClose={onClose}>
    {error && <Notice tone="warning" title="Unavailable">{error} <Button variant="soft" onClick={reload}>Reload prescription</Button></Notice>}
    {voidError && <div role="alert"><p className="au-error">{voidError}</p>{!error && operation?.phase !== 'recovery' && <Button variant="soft" onClick={reload}>Reload prescription</Button>}</div>}
    {operation?.phase === 'recovery' && <Notice tone="warning" title="Void result unconfirmed">The original request may have succeeded. Reload to check for a verified Void state; do not repeat it based on an unchanged Issued record. {!error && <Button variant="soft" onClick={reload}>Reload prescription</Button>}</Notice>}
    {(busy || operation?.phase === 'pending') && <p role="status">Voiding the original prescription. Closing this dialog does not cancel the transmitted request.</p>}
    {!isCurrent() && <Notice title="Session unavailable">Close this dialog and sign in again before continuing.</Notice>}
    {!p ? !error && isCurrent() && <p className="au-muted" role="status">Loading…</p> : <div className="st-handover">
      <p className="au-muted"><span className={`fd-badge ${TONE[p.status]}`}>{p.status === 'Void' ? 'VOID' : p.status}</span> {p.date ? day(p.date) : ''} · {p.dentist} · {p.branch}{p.license_no ? ` · License no. ${p.license_no}` : ''}</p>
      {p.voided && <Notice tone="warning" title="Void">Reason: {p.voided.reason}</Notice>}
      {p.lines && p.lines.length > 0 ? <ol className="rx-view">{p.lines.map((l, i) => <li key={i}><b>{l.medicine}</b>
        <span>{[l.dosage && `Dosage: ${l.dosage}`, l.frequency && `Frequency: ${l.frequency}`, l.duration && `Duration: ${l.duration}`].filter(Boolean).join(' · ')}</span>
        {l.instructions && <span>Instructions: {l.instructions}</span>}</li>)}</ol>
        : !p.lines && <p className="au-muted" style={{ padding: '0.75rem', background: 'var(--surface-muted, #f8fafc)', borderRadius: '6px' }}>Medication details and instructions are private clinical records accessible only to the treating dentist, authorized branch front desk, and the patient.</p>}
      {p.note && <p><b>Note:</b> {p.note}</p>}
      {voiding && <Field label="Reason for voiding" required><input value={reason} disabled={protectedVoid} maxLength={300} onChange={e => setReason(e.target.value)}/></Field>}
      <div className="ns-actions">
        {onEdit && p.status === 'Draft' && p.can_edit && <Button variant="soft" onClick={() => onEdit(p.id)}>Edit draft</Button>}
        {p.status !== 'Draft' && Array.isArray(p.lines) && <Button variant="soft" icon="download" onClick={async () => { const r = await downloadPrescriptionPdf(p.id, p.number); if (!r.ok&&owns()) toast(r.message || 'The PDF could not be downloaded.', 'warning') }}>Download PDF</Button>}
        {p.can_void && p.status === 'Issued' && !voiding && <Button disabled={protectedVoid || !ledger} variant="ghost" onClick={() => setVoiding(true)}>Void…</Button>}
        {voiding && <Button disabled={protectedVoid || !ledger || reason.trim().length < 3} onClick={doVoid}>{busy ? 'Voiding…' : 'Void this prescription'}</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>}
  </Modal>
}
