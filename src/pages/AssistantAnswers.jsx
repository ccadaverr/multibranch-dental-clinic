import {SelectionDetailsNotice} from '../selection-details.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { commandKey } from '../appointments-api.js'
import { Button, Empty, Field, Icon, Modal, Notice, PageHeader } from '../components.jsx'
import { createAssistantAnswer, listAssistantAnswers, listBranches, testAssistantAnswer, updateAssistantAnswer } from '../api-client.js'

const CATEGORY_LABELS = { about: 'About the clinic', services: 'Services', branches: 'Branches and directions', hours: 'Hours and busy times', booking: 'Booking',
  changes: 'Reschedule and cancel', payment: 'Payment and receipts', account: 'Account and sign-in', contact: 'Contact', care: 'Dental-care tips', hmo: 'HMO', other: 'Other' }
const LIMITS = { question: 200, answer: 1000, keyword: 60, keywords: 40 }

/**
 * Administration → Assistant answers (Owner): the clinic's own answers that the Clinic Assistant gives in knowledge mode.
 * Services, branches, hours, payment methods and each Patient's own records are answered from the live records and are not
 * edited here. Every change is saved and audited by the server; nothing is kept in the browser.
 */
export function AssistantAnswersPage({ store }) {
  const toast = store?.toast || (() => {})
  const [rows, setRows] = useState(null), [meta, setMeta] = useState({ drafts: 0, categories: Object.keys(CATEGORY_LABELS) })
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState('all'), [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // {} for a new answer, or an answer
  const [branches, setBranches] = useState([])
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let live = true
    setError('')
    listAssistantAnswers().then(r => {
      if (!live) return
      if (!r.ok) return setError(r.message || 'The answers could not be loaded.')
      setRows(r.data || []); setMeta(m => ({ ...m, ...(r.meta || {}) }))
    })
    return () => { live = false }
  }, [attempt])
  useEffect(() => { listBranches().then(r => { if (r.ok) setBranches((r.data || []).map(b => ({ id: b.id, name: b.name }))) }) }, [])

  const shown = useMemo(() => (rows || []).filter(a => (filter === 'drafts' ? a.active && a.draft : filter === 'inactive' ? !a.active : filter === 'all' ? true : a.active && !a.draft))
    .filter(a => `${a.question} ${a.answer} ${(a.keywords || []).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, filter, q])

  const saved = row => { setRows(list => list.some(a => a.id === row.id) ? list.map(a => a.id === row.id ? row : a) : [row, ...list]); setAttempt(a => a + 1) }
  const patch = async (answer, changes, message) => {
    setBusyId(answer.id)
    const r = await updateAssistantAnswer(answer.id, { ...changes, expected_revision: answer.revision })
    setBusyId(null)
    if (!r.ok) { toast(r.message || 'The answer was not saved.', 'warning'); if (r.code === 'stale_revision') setAttempt(a => a + 1); return }
    saved(r.data); toast(message, 'success')
  }

  return <div className="aa-page">
    <PageHeader kicker="Administration" title="Assistant answers"
      text="What the Clinic Assistant answers from the clinic’s own information. Services, branches, hours, payment methods and each patient’s own appointments and balance come from the records automatically."
      aside={<Button icon="plusCalendar" onClick={() => setEditing({})}>Add an answer</Button>}/>

    {meta.drafts > 0 && <Notice tone="warning" title={`${meta.drafts} draft answer${meta.drafts === 1 ? '' : 's'} need the clinic’s confirmation`}>
      Drafts were written from the clinic interview and the portal’s own behaviour. Patients already see them; read each one, correct it if needed, then choose Confirm.
      <Button size="sm" variant="ghost" onClick={() => setFilter('drafts')}>Show drafts</Button>
    </Notice>}

    <TestBox/>

    <div className="aa-toolbar">
      <div className="pp-tabs" role="tablist" aria-label="Filter answers">
        {[['all', 'All'], ['confirmed', 'Confirmed'], ['drafts', 'Drafts'], ['inactive', 'Inactive']].map(([key, label]) =>
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <label className="pp-search"><Icon name="search" size={18}/><span className="sr-only">Search answers</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search questions, answers and keywords"/></label>
    </div>

    {error && <Notice tone="warning" title="Answers unavailable">{error} <Button size="sm" variant="ghost" onClick={() => setAttempt(a => a + 1)}>Try again</Button></Notice>}
    {!error && rows === null && <div className="pp-skeleton pp-card" role="status" aria-label="Loading answers"><span className="pp-shimmer" style={{ width: '70%' }}/><span className="pp-shimmer" style={{ width: '90%' }}/><span className="pp-shimmer" style={{ width: '60%' }}/></div>}
    {rows !== null && !shown.length && <Empty title="No answers here" text={rows.length ? 'Nothing matches this filter.' : 'Add the clinic’s first answer.'}/>}

    <ul className="aa-list">
      {shown.map(a => <li key={a.id} className={`pp-card aa-item ${a.active ? '' : 'is-inactive'}`}>
        <div className="aa-item-head">
          <span className="pp-pill info">{CATEGORY_LABELS[a.category] || a.category}</span>
          {a.category === 'other' && a.category_detail && <span>{a.category_detail}</span>}
          {a.draft && a.active && <span className="pp-pill wait">Draft</span>}
          {!a.active && <span className="pp-pill off">Inactive</span>}
          {a.branch && <span className="pp-pill off">{a.branch.name}</span>}
        </div>
        <h3>{a.question}</h3>
        <p>{a.answer}</p>
        {!!a.keywords?.length && <p className="aa-keywords"><span className="sr-only">Keywords: </span>{a.keywords.map(k => <span key={k}>{k}</span>)}</p>}
        {a.source && <p className="pp-hint">Source: {a.source}</p>}
        <div className="pp-actions">
          <Button size="sm" variant="soft" onClick={() => setEditing(a)}>Edit</Button>
          {a.draft && a.active && <Button size="sm" disabled={busyId === a.id} onClick={() => patch(a, { draft: false }, 'Answer confirmed.')}>Confirm</Button>}
          <Button size="sm" variant="ghost" disabled={busyId === a.id} onClick={() => patch(a, { active: !a.active }, a.active ? 'Answer deactivated: patients no longer get it.' : 'Answer active again.')}>{a.active ? 'Deactivate' : 'Activate'}</Button>
        </div>
      </li>)}
    </ul>

    {editing && <EditAnswer selectionDetailsAvailable={store?.session?.selectionDetailsAvailable===true} answer={editing} categories={meta.categories} branches={branches} onClose={() => setEditing(null)}
      onSaved={row => { setEditing(null); saved(row); toast(editing.id ? 'Answer saved.' : 'Answer added.', 'success') }}/>}
  </div>
}

function TestBox() {
  const [q, setQ] = useState(''), [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const run = async e => {
    e.preventDefault()
    if (!q.trim() || busy) return
    setBusy(true); setError('')
    const r = await testAssistantAnswer(q.trim())
    setBusy(false)
    if (!r.ok) return setError(r.message || 'The test could not run.')
    setResult(r.data)
  }
  const source = result?.source === 'answer' ? `From the answer “${result.entry?.question}”${result.entry?.draft ? ' (draft)' : ''}`
    : result?.source === 'clinic_records' ? 'From the clinic records (services, branches, hours, payment or the patient’s own records)' : 'No answer: handed to the front desk or redirected'
  return <section className="pp-card aa-test" aria-labelledby="aa-test-title">
    <h2 id="aa-test-title"><Icon name="robot" size={20}/> Test a question</h2>
    <p className="pp-hint">Type a question the way a patient would (English, Filipino or Taglish). Nothing is saved.</p>
    <form onSubmit={run} className="aa-test-form">
      <label className="sr-only" htmlFor="aa-test-input">Question</label>
      <input id="aa-test-input" value={q} maxLength={500} onChange={e => setQ(e.target.value)} placeholder="e.g. Bukas ba kayo sa Linggo?"/>
      <Button type="submit" disabled={busy || !q.trim()}>{busy ? 'Testing…' : 'Test'}</Button>
    </form>
    {error && <p className="pp-error-text" role="alert">{error}</p>}
    {result && <div className="aa-result" role="status">
      <p className="aa-answer">{result.answer}</p>
      <p className="pp-hint">{source} · confidence {Math.round((result.confidence || 0) * 100)}%</p>
      {!!result.suggestions?.length && <p className="pp-hint">Suggested questions: {result.suggestions.join(' · ')}</p>}
    </div>}
  </section>
}

function EditAnswer({ selectionDetailsAvailable = false, answer, categories, branches, onClose, onSaved }) {
  const isNew = !answer.id
  const createKey = useRef(commandKey())
  const [form, setForm] = useState({ question: answer.question || '', answer: answer.answer || '', category: answer.category || 'other', category_detail: answer.category_detail || '',
    keywords: (answer.keywords || []).join(', '), branch: answer.branch?.id || '', draft: isNew ? false : !!answer.draft })
  const [errors, setErrors] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const set = key => e => { setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); setErrors(x => ({ ...x, [key]: null })) }
  const keywords = form.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  const check = () => {
    const found = {}
    if (form.category === 'other' && !form.category_detail.trim()) found.category_detail = 'Specify the category.'
    if (form.question.trim().length < 5) found.question = 'Write the question (at least 5 characters).'
    if (form.answer.trim().length < 5) found.answer = 'Write the answer (at least 5 characters).'
    if (keywords.length > LIMITS.keywords) found.keywords = `Use at most ${LIMITS.keywords} keywords.`
    if (keywords.some(k => k.length < 2 || k.length > LIMITS.keyword)) found.keywords = `Each keyword needs 2 to ${LIMITS.keyword} characters.`
    return found
  }
  const save = async e => {
    e.preventDefault()
    if (busy) return
    if (!selectionDetailsAvailable && form.category === 'other') return setError('Other categories cannot be saved in this workspace yet. Your draft is retained.');
    const found = check()
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true); setError('')
    const payload = { question: form.question.trim(), answer: form.answer.trim(), category: form.category, ...(form.category === 'other' ? { category_detail: form.category_detail.trim() } : {}), keywords: [...new Set(keywords)], branch_ref: form.branch || null, draft: form.draft }
    const r = isNew ? await createAssistantAnswer(payload, createKey.current) : await updateAssistantAnswer(answer.id, { ...payload, expected_revision: answer.revision })
    setBusy(false)
    if (!r.ok) {
      if (r.kind === 'validation') setErrors(Object.fromEntries(Object.entries(r.errors || {}).map(([k, v]) => [k.startsWith('keywords') ? 'keywords' : k, Array.isArray(v) ? v[0] : String(v)])))
      return setError(r.message || 'The answer was not saved.')
    }
    onSaved(r.data)
  }
  return <Modal open title={isNew ? 'Add an answer' : 'Edit the answer'} subtitle="Patients see this answer exactly as written. Keep it short, true and confirmed by the clinic." onClose={onClose} wide>
    <form onSubmit={save} noValidate className="aa-form">
      {!selectionDetailsAvailable&&<Notice tone="info">Other categories are unavailable for new or changed answers. Existing answers remain available.</Notice>}
      <Field label={`Question (${form.question.length}/${LIMITS.question})`} required error={errors.question}><input value={form.question} maxLength={LIMITS.question} onChange={set('question')}/></Field>
      <Field label={`Answer (${form.answer.length}/${LIMITS.answer})`} required error={errors.answer} hint="Plain text. Do not include prices or promises the clinic has not approved.">
        <textarea rows={5} value={form.answer} maxLength={LIMITS.answer} onChange={set('answer')}/>
      </Field>
      <Field label="Keywords" error={errors.keywords} hint="Comma-separated words patients might use, in English, Filipino or Taglish (e.g. parking, paradahan).">
        <input value={form.keywords} onChange={set('keywords')}/>
      </Field>
      <div className="aa-form-row">
        <Field label="Category"><select value={form.category} onChange={e => {
          const category = e.target.value
          setForm(f => ({ ...f, category, category_detail: category === 'other' ? f.category_detail : '' }))
          setErrors(f => ({ ...f, category_detail: null }))
        }}>{categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}</select></Field>
        <Field label="Only for one branch" hint="Leave empty for every branch."><select value={form.branch} onChange={set('branch')}><option value="">Every branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </div>
      {form.category === 'other' && <Field label="Specify category" required error={errors.category_detail}>
        <input required maxLength={255} value={form.category_detail} onChange={set('category_detail')} placeholder="e.g., Accessibility information"/>
      </Field>}
      <label className="aa-check"><input type="checkbox" checked={form.draft} onChange={set('draft')}/> Draft — still to be confirmed by the clinic</label>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <div className="form-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy||!selectionDetailsAvailable&&form.category==='other'}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </form>
  </Modal>
}
