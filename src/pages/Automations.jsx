import React, { useEffect, useState } from 'react'
import { Button, RefreshButton, Card, Field, Notice, PageHeader } from '../components.jsx'
import {
  approveMessageTemplate, listAutomations, listMessageTemplates, previewMessageTemplate, runAutomationDemo, testAutomation, testMessageTemplate,
  updateAutomation, updateMessageTemplate,
} from '../api-client.js'

const manila = iso => iso ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : 'Not run yet'
const time12 = hhmm => { if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return hhmm; const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const onOff = v => (v ? 'on' : 'off')
const DEFAULT_TEXT = {
  lead_minutes: v => `${v} minutes before`, day_before: onOff, morning_of: onOff, morning_time: time12,
  check_minutes: v => `${v} minutes after the start`, late_minutes: v => `${v} minutes after the start`, release_minutes: v => `${v} minutes after the start`,
  release_mode: v => (v === 'automatic' ? 'release automatically' : 'ask the front desk'), rebook_email: onOff,
  offer_count: v => `${v} patients`, min_notice_minutes: v => `${v} minutes`, waitlist_after_minutes: v => `${v} minutes`,
  days: v => `after ${v.join(', ')} days`, rules: v => (v.length ? v.map(r => `${r.category}: ${r.months} months`).join('; ') : 'no rules'),
  notify_count: v => `${v} patients`, send_time: time12, late_hours: v => `${v} hours`, limit: v => `${v} times`, window_months: v => `${v} months`, crowded_percent: v => `${v}% booked`,
  store_id_last4: onOff, id_upload: onOff, id_upload_days: v => `${v} days`,
}
const sourceText = src => (src ? `from clinic interview R2 (${src})` : 'recommended, not confirmed by the clinic')

/** Plain words for each row (the full description stays in the details). Grouped as the Owner thinks of them. */
const GROUPS = [
  ['Appointments', ['appointment_reminders', 'no_show', 'fill_slots', 'waitlist']],
  ['Payments', ['overdue_invoices']],
  ['Reports', ['owner_summary', 'recall', 'followup_reminders']],
]
const SHORT = {
  appointment_reminders: 'Reminds patients before their visit.',
  no_show: 'Asks late patients if they are coming, and frees the time when they are not.',
  fill_slots: 'Offers a freed time to patients booked later that day.',
  waitlist: 'Tells waiting patients when a time opens on a full day.',
  overdue_invoices: 'Reminds patients of an unpaid invoice.',
  owner_summary: 'Emails you the day’s numbers each evening.',
  recall: 'Invites patients back for a check-up.',
  followup_reminders: 'Reminds a patient when a follow-up the dentist asked for is due.',
  attendance_policy: 'When a cancellation counts as late, and when bookings need the front desk.',
  calendar_load: 'When the calendar marks a day as crowded.',
  intake: 'Counter registration and the ID check.',
  staffing: 'Who approves leave, who edits schedules, how long a handover gives access.',
  prescriptions: 'Common medicine names dentists can pick from (optional).',
  dental_chart: 'Tooth numbering and the statuses a dentist records.',
}

/**
 * Administration → Automations (Owner): the emails the system sends by itself and four clinic policies, as one compact row each
 * (plain name, one line, an on/off switch and a status chip); timings, wording, last run and the 7-day counts open in the row's
 * details. An automation that sends email can be switched on only after the Owner approved its wording (R2-09); recall and
 * follow-up reminders also need a Dentist. The demo clock and test emails exist only on the demo database. Every change is
 * validated and audited by the server; nothing is kept in the browser.
 */
export function AutomationsPage({ store, setPage }) {
  const toast = store?.toast || (() => {})
  const [rows, setRows] = useState(null), [meta, setMeta] = useState({ categories: [], demo: false })
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [wordingKey, setWordingKey] = useState('')

  useEffect(() => {
    let live = true
    listAutomations().then(r => {
      if (!live) return
      if (!r.ok) return setError(r.message || 'The automations could not be loaded.')
      setError(''); setRows(r.data || []); setMeta(m => ({ ...m, ...(r.meta || {}) }))
    })
    return () => { live = false }
  }, [attempt])

  const saved = r => { setRows(r.data || []); setMeta(m => ({ ...m, ...(r.meta || {}) })) }
  const byKey = Object.fromEntries((rows || []).map(r => [r.key, r]))
  const grouped = GROUPS.map(([title, keys]) => [title, keys.map(k => byKey[k]).filter(Boolean)])
  const listed = new Set(GROUPS.flatMap(([, keys]) => keys))
  const other = (rows || []).filter(r => r.kind !== 'policy' && !listed.has(r.key)), policies = (rows || []).filter(r => r.kind === 'policy')
  const openWording = key => { setWordingKey(key); requestAnimationFrame(() => document.getElementById(`tpl-${key}`)?.scrollIntoView({ block: 'center' })) }
  const rowProps = { categories: meta.categories, demo: meta.demo, toast, onSaved: saved, onStale: () => setAttempt(a => a + 1), onWording: openWording, onAudit: () => setPage?.('audit') }

  return <div className="au-page">
    <PageHeader kicker="Administration" title="Automations" text="Emails the system sends for you. Nothing is sent until you approve its wording."/>
    {error && <Notice tone="warning" title="Automations unavailable">{error} <Button size="sm" variant="ghost" onClick={() => setAttempt(a => a + 1)}>Try again</Button></Notice>}
    {!rows && !error && <p className="au-muted" role="status">Loading automations…</p>}
    {rows && [...grouped, ...(other.length ? [['Other', other]] : [])].filter(([, list]) => list.length).map(([title, list]) => <section key={title} className="au-group" aria-labelledby={`au-g-${title}`}>
      <h2 className="au-section" id={`au-g-${title}`}>{title}</h2>
      <ul className="au-rows">{list.map(row => <AutomationRow key={row.key} row={row} {...rowProps}/>)}</ul>
    </section>)}
    {policies.length > 0 && <section className="au-group" aria-labelledby="au-g-policies">
      <h2 className="au-section" id="au-g-policies">Clinic settings</h2>
      <ul className="au-rows">{policies.map(row => <AutomationRow key={row.key} row={row} {...rowProps}/>)}</ul>
    </section>}
    <MessageWording toast={toast} demo={meta.demo} openKey={wordingKey} onOpen={setWordingKey} onChanged={() => setAttempt(a => a + 1)}/>
    {meta.demo && <details className="au-demo-tools"><summary>Demo tools <small>(demo database only)</small></summary>
      <DemoClockCard toast={toast} onDone={() => setAttempt(a => a + 1)}/>
    </details>}
  </div>
}

const STATUS = { active: ['Active', 'is-ok'], wording: ['Needs wording approval', 'is-wait'], off: ['Off', 'is-off'] }

function AutomationRow({ row, categories, demo, toast, onSaved, onStale, onWording, onAudit }) {
  const [draft, setDraft] = useState(row.settings)
  const [busy, setBusy] = useState(''), [fieldError, setFieldError] = useState(''), [open, setOpen] = useState(false)
  useEffect(() => { setDraft(row.settings); setFieldError('') }, [row.revision])
  const dirty = JSON.stringify(draft) !== JSON.stringify(row.settings)
  const stats = row.last_7_days || {}
  const id = `au-${row.key}`
  const policy = row.kind === 'policy'
  const unapproved = (row.templates || []).filter(t => !t.approved)
  const blocked = !row.enabled && unapproved.length > 0
  const [label, tone] = STATUS[row.enabled ? 'active' : blocked ? 'wording' : 'off']

  const save = async body => {
    setBusy('save'); setFieldError('')
    const r = await updateAutomation(row.key, { ...body, expected_revision: row.revision })
    setBusy('')
    if (!r.ok) {
      if (r.code === 'stale_revision') { toast(r.message, 'warning'); return onStale() }
      setFieldError(r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message || 'Not saved.')
      if (!open) toast(r.message || 'Not saved.', 'warning')
      return
    }
    onSaved(r); toast(`${row.name} saved.`, 'success')
  }
  const test = async () => {
    setBusy('test')
    const r = await testAutomation(row.key)
    setBusy('')
    const status = r.data?.status
    if (!r.ok) return toast(r.message || 'The test email could not be sent.', 'warning')
    toast(status === 'logged_only' ? 'Test recorded in the local mail log only (no email was sent).' : 'Test email accepted by the mail service. Check your inbox.', status === 'logged_only' ? 'warning' : 'success')
  }
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const hint = k => `Default: ${DEFAULT_TEXT[k] ? DEFAULT_TEXT[k](row.defaults.settings[k]) : row.defaults.settings[k]} · ${sourceText(row.defaults.sources?.[k])}${row.owner_saved ? ' · saved by the Owner' : ''}`
  const num = (k, label, min, max) => <Field label={label} hint={hint(k)}><input type="number" min={min} max={max} value={draft[k]} onChange={e => set(k, Number(e.target.value))}/></Field>
  const check = (k, label) => <label className="au-check"><input type="checkbox" checked={!!draft[k]} onChange={e => set(k, e.target.checked)}/> {label} <small>{hint(k)}</small></label>

  return <li className={`au-row ${row.enabled ? '' : 'is-off'}`}>
    <div className="au-row-head">
      <div className="au-row-text"><b>{row.name}</b><span>{SHORT[row.key] || row.description}</span></div>
      {!policy && <span className={`au-chip ${tone}`}>{label}</span>}
      {!policy && <button type="button" role="switch" aria-checked={row.enabled} aria-label={`${row.name}: ${row.enabled ? 'on' : 'off'}`} className="au-switch" disabled={!!busy || blocked}
        title={blocked ? 'Approve the wording first' : undefined} onClick={() => save({ enabled: !row.enabled })}><span aria-hidden="true"/>{row.enabled ? 'On' : 'Off'}</button>}
      <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={`${id}-details`} onClick={() => setOpen(o => !o)}>{open ? 'Hide details' : policy ? 'Settings' : 'Details'}</Button>
    </div>
    {blocked && <p className="au-row-note" role="note">{unapproved.map(t => <button key={t.key} type="button" className="link-button" onClick={() => onWording(t.key)}>Approve the wording first: {t.name}</button>)}</p>}
    {open && <div className="au-row-body" id={`${id}-details`}>
      <p className="au-desc">{row.description}</p>
      <p className="au-muted">{row.module} · default {row.defaults.enabled ? 'on' : 'off'}, {sourceText(row.defaults.sources?.enabled)}</p>
      {(row.templates || []).length > 0 && <p className="au-wording">Wording: {row.templates.map(t => <button key={t.key} type="button" className={`au-tag ${t.approved ? 'is-ok' : 'is-wait'}`} onClick={() => onWording(t.key)}>{t.approved ? '✓' : '!'} {t.name}{t.approved ? ' approved' : t.needs_dentist ? ' needs Owner and Dentist approval' : ' needs approval'}</button>)}</p>}
      <form className="au-form" aria-labelledby={id} onSubmit={e => { e.preventDefault(); if (dirty) save({ settings: draft }) }}>
        <span id={id} hidden>{row.name} settings</span>
        {row.key === 'appointment_reminders' && <>
          {num('lead_minutes', 'Remind this many minutes before the visit', 15, 240)}
          {check('day_before', 'Also remind 24 hours before')}
          {check('morning_of', 'Also remind on the morning of the visit')}
          <Field label="Morning reminder time" hint={hint('morning_time')}><input type="time" value={draft.morning_time} disabled={!draft.morning_of} onChange={e => set('morning_time', e.target.value)}/></Field>
        </>}
        {row.key === 'no_show' && <>
          {num('check_minutes', '“Are you on your way?” after (minutes)', 1, 60)}
          {num('late_minutes', 'Show as Late and queue last after (minutes)', 1, 120)}
          {num('release_minutes', 'Release the time after (minutes)', 5, 240)}
          <Field label="At the release time" hint={hint('release_mode')}>
            <select value={draft.release_mode} onChange={e => set('release_mode', e.target.value)}>
              <option value="automatic">Release automatically (the front desk can undo it today)</option>
              <option value="ask">Ask the front desk (possible no-show)</option>
            </select>
          </Field>
          {check('rebook_email', 'Email “We missed you, book a new time” after a release or a confirmed no-show')}
        </>}
        {row.key === 'fill_slots' && <>
          {num('offer_count', 'How many later patients to offer a freed time to', 1, 10)}
          {num('min_notice_minutes', 'Offer only times at least this many minutes away', 0, 240)}
          {num('waitlist_after_minutes', 'Head start for move-up offers before the waitlist hears (minutes)', 0, 1440)}
        </>}
        {row.key === 'overdue_invoices' && <Field label="Remind after (days since the invoice was issued, up to 3)" hint={hint('days')}>
          <input inputMode="numeric" value={(draft.days || []).join(', ')} onChange={e => set('days', e.target.value.split(/[\s,]+/).filter(Boolean).map(Number))}/>
        </Field>}
        {row.key === 'recall' && <RecallRules rules={draft.rules || []} categories={categories} onChange={rules => set('rules', rules)} hint={hint('rules')}/>}
        {row.key === 'waitlist' && num('notify_count', 'How many waiting patients to tell when a time opens', 1, 10)}
        {row.key === 'owner_summary' && <Field label="Send time" hint={hint('send_time')}><input type="time" value={draft.send_time} onChange={e => set('send_time', e.target.value)}/></Field>}
        {row.key === 'attendance_policy' && <>
          {num('late_hours', 'A cancellation is late when made less than this many hours before', 1, 72)}
          {num('limit', 'Late cancellations or no-shows before bookings need confirmation', 1, 10)}
          {num('window_months', 'Counted over the last (months)', 1, 24)}
        </>}
        {row.key === 'calendar_load' && num('crowded_percent', 'Mark a day as crowded at (% of the dentists’ time booked)', 50, 100)}
        {row.key === 'staffing' && <>
          <Field label="Who approves leave requests" hint={hint('leave_approver')}>
            <select value={draft.leave_approver} onChange={e => set('leave_approver', e.target.value)}>
              <option value="owner">The Owner only</option>
              <option value="owner_or_front_desk">The Owner or the front desk of the requester’s branch</option>
            </select>
          </Field>
          {check('front_desk_edits_schedules', 'The front desk may edit the work schedules of the dentists at their branch')}
          {num('handover_access_days', 'After a handover is acknowledged, the receiving branch keeps the patient’s record for (days)', 1, 365)}
        </>}
        {row.key === 'dental_chart' && <>
          <Field label="Tooth numbering" hint={hint('numbering')}><select value={draft.numbering} onChange={e => set('numbering', e.target.value)}><option value="fdi">FDI (11–48, primary 51–85)</option><option value="universal">Universal (1–32, primary A–T)</option></select></Field>
          <Field label="Statuses a dentist can record (one per line)" hint="Changing the list does not change what was already recorded."><textarea rows={6} value={(draft.statuses || []).join('\n')} onChange={e => set('statuses', e.target.value.split('\n'))}/></Field>
        </>}
        {row.key === 'prescriptions' && <Field label="Common medicines (one per line, optional)" hint="Shown as suggestions while a dentist types; any medicine can still be typed. No doses, no checks.">
          <textarea rows={5} value={(draft.common_medicines || []).join('\n')} onChange={e => set('common_medicines', e.target.value.split('\n').map(x => x.trimStart()).filter((x, i, all) => x || i < all.length - 1))}/>
        </Field>}
        {row.key === 'intake' && <>
          {check('store_id_last4', 'Keep the last 4 characters of the ID when the front desk checks it (never the full number)')}
          <label className="au-check"><input type="checkbox" checked={false} disabled/> Let patients upload an ID photo for remote pre-verification <small>Not available in this release. The ID photo is read on the patient’s phone and never uploaded or kept.</small></label>
        </>}
        {fieldError && <p className="au-error" role="alert">{fieldError}</p>}
        <div className="au-actions">
          <Button type="submit" size="sm" disabled={!dirty || !!busy}>{busy === 'save' ? 'Saving…' : 'Save changes'}</Button>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(row.settings)}>Undo</Button>}
          {!policy && demo && <Button size="sm" variant="soft" icon="mail" disabled={!!busy} onClick={test}>{busy === 'test' ? 'Sending…' : 'Send a test to myself'}</Button>}
        </div>
      </form>
      {!policy && <p className="au-activity"><b>Recent activity</b> (last 7 days): {stats.sent ?? 0} sent · {stats.skipped ?? 0} skipped · <span className={stats.failed ? 'is-bad' : ''}>{stats.failed ?? 0} failed</span>
        {row.key === 'no_show' ? ` · ${stats.flagged ?? 0} flagged` : ''}{stats.pending > 0 ? ` · ${stats.pending} waiting to send` : ''} · last run {manila(row.last_run_at)}
        {stats.failed > 0 && <> · <button type="button" className="link-button" onClick={onAudit}>See the failed emails in the Audit Trail</button></>}</p>}
    </div>}
  </li>
}

function RecallRules({ rules, categories, onChange, hint }) {
  const unused = categories.filter(c => !rules.some(r => r.category === c))
  return <fieldset className="au-rules">
    <legend>Recall intervals (one per service category)</legend>
    <p className="au-muted">Suggested, needs a Dentist’s approval. A Dentist approves these intervals together with the recall wording; changing them asks again.</p>
    {!rules.length && <p className="au-muted">No intervals, so nothing is sent.</p>}
    {rules.map((r, i) => <div className="au-rule" key={r.category}>
      <span>{r.category}</span>
      <label>after <input type="number" min="1" max="36" aria-label={`Months after a ${r.category} visit`} value={r.months} onChange={e => onChange(rules.map((x, j) => j === i ? { ...x, months: Number(e.target.value) } : x))}/> months</label>
      <Button size="sm" variant="ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))}>Remove</Button>
    </div>)}
    {unused.length > 0 && <label className="au-add">Add an interval for <select value="" onChange={e => e.target.value && onChange([...rules, { category: e.target.value, months: 6 }])}>
      <option value="">Choose a service category…</option>{unused.map(c => <option key={c}>{c}</option>)}
    </select></label>}
    <small className="au-muted">{hint}.</small>
  </fieldset>
}

/** F1: the wording of every automated email, with preview, test and approval. Saving new wording clears its approval. */
function MessageWording({ toast, onChanged, demo, openKey, onOpen }) {
  const [rows, setRows] = useState(null), [error, setError] = useState('')
  const open = openKey, setOpen = f => onOpen(typeof f === 'function' ? f(openKey) : f)
  useEffect(() => { listMessageTemplates().then(r => { if (r.ok) setRows(r.data || []); else setError(r.message || 'The wording could not be loaded.') }) }, [])
  const changed = t => { setRows(list => list.map(x => x.key === t.key ? t : x)); onChanged() }
  if (error) return <Notice tone="warning" title="Message wording unavailable">{error}</Notice>
  if (!rows) return null
  const waiting = rows.filter(t => !t.approved).length
  return <Card className="au-wording-card" title="Email wording" subtitle={waiting ? `${waiting} of ${rows.length} still need approval` : 'All approved'}>
    <p className="au-desc">The words of each automated email. The date, time, branch, address, buttons and calendar file are added by the system and cannot be removed. Health-related wording (recall) also needs a Dentist’s approval.</p>
    <ul className="au-tpl-list">
      {rows.map(t => <li key={t.key} id={`tpl-${t.key}`} className={open === t.key ? 'is-open' : ''}>
        <div className="au-tpl-head">
          <div><b>{t.name}</b> <span className={`au-tag ${t.approved ? 'is-ok' : 'is-wait'}`}>{t.approved ? '✓ Approved' : t.owner_approval && t.needs_dentist ? '! Needs a Dentist' : '! Needs approval'}</span>
            <small className="au-muted">{t.owner_approval ? `Owner: ${t.owner_approval.by}, ${manila(t.owner_approval.at)}` : 'Not approved by the Owner yet'}{t.needs_dentist ? ` · Dentist: ${t.dentist_approval ? `${t.dentist_approval.by}, ${manila(t.dentist_approval.at)}` : 'not yet'}` : ''}{t.is_default ? ' · our recommended wording' : ''}</small></div>
          <Button size="sm" variant="ghost" aria-expanded={open === t.key} onClick={() => setOpen(o => (o === t.key ? '' : t.key))}>{open === t.key ? 'Close' : 'Review'}</Button>
        </div>
        {open === t.key && <TemplateEditor template={t} toast={toast} onChanged={changed} showTest={demo}/>}
      </li>)}
    </ul>
  </Card>
}

export function TemplateEditor({ template, toast, onChanged, approveAction = approveMessageTemplate, canEdit = true, showTest = true }) {
  const [draft, setDraft] = useState({ subject: template.subject, body: template.body })
  const [previewResult, setPreviewResult] = useState(null), [commandBusy, setBusy] = useState(''), [commandError, setErr] = useState('')
  const dirty = draft.subject !== template.subject || draft.body !== template.body
  const live = React.useRef(false), previewContext = React.useRef(null)
  const signature = JSON.stringify([template.key, template.revision, draft.subject, draft.body])
  if (previewContext.current?.signature !== signature) previewContext.current = {signature, pending: false}
  const scope = previewContext.current
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const preview = previewResult?.scope === scope ? previewResult.data : null
  const busy = commandBusy || (previewResult?.scope === scope && previewResult.pending ? 'preview' : '')
  const err = commandError || (previewResult?.scope === scope ? previewResult.error : '')
  const show = async () => {
    if (!live.current || previewContext.current !== scope || scope.pending || commandBusy) return
    scope.pending = true; setErr(''); setPreviewResult({scope, pending: true, data: null, error: ''})
    let r
    try { r = await previewMessageTemplate(template.key, dirty ? {...draft} : null) }
    catch { r = {ok: false} }
    scope.pending = false
    if (!live.current || previewContext.current !== scope) return
    if (!r?.ok || typeof r.data?.subject !== 'string' || typeof r.data?.html !== 'string') {
      return setPreviewResult({scope, pending: false, data: null, error: 'Preview could not be loaded. Try again.'})
    }
    setPreviewResult({scope, pending: false, data: r.data, error: ''})
  }
  useEffect(() => { if (canEdit) show() }, [canEdit, template.key, template.revision])
  const save = async () => {
    setBusy('save'); setErr('')
    const r = await updateMessageTemplate(template.key, { ...draft, expected_revision: template.revision })
    setBusy('')
    if (!r.ok) return setErr(r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message)
    onChanged(r.data); toast('Wording saved. Approve it to use it.', 'success')
  }
  const approve = async () => {
    setBusy('approve')
    const r = await approveAction(template.key, template.revision)
    setBusy('')
    if (!r.ok) return setErr(r.message)
    onChanged(r.data); toast(r.data.approved ? 'Wording approved.' : 'Approved by you. A Dentist still needs to approve it.', 'success')
  }
  const test = async () => {
    setBusy('test')
    const r = await testMessageTemplate(template.key)
    setBusy('')
    toast(r.ok ? 'Test email sent to you.' : r.message || 'The test email could not be sent.', r.ok ? 'success' : 'warning')
  }
  const approvedByMe = canEdit ? !!template.owner_approval : !!template.dentist_approval
  return <div className="au-tpl-edit">
    <div className="au-form">
      {canEdit ? (
        <>
          <Field label="Subject"><input value={draft.subject} maxLength={140} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}/></Field>
          <Field label="Message" hint={`Plain text. A blank line starts a new paragraph. You can use: ${template.placeholders.map(p => `{${p}}`).join(' ')}`}>
            <textarea rows={6} value={draft.body} maxLength={1200} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}/>
          </Field>
        </>
      ) : (
        <div className="au-readonly-wording">
          <div className="au-readonly-field">
            <span className="au-readonly-label">Subject</span>
            <div className="au-readonly-value font-semibold">{draft.subject}</div>
          </div>
          <div className="au-readonly-field">
            <span className="au-readonly-label">Message wording</span>
            <div className="au-readonly-body">{draft.body}</div>
          </div>
          <div className="au-approval-status-bar">
            {template.owner_approval ? (
              <span className="au-tag is-ok">Owner approved: {template.owner_approval.by}</span>
            ) : (
              <span className="au-tag is-wait">Owner approval pending</span>
            )}
            {template.dentist_approval ? (
              <span className="au-tag is-ok au-approved-badge">Dentist approved: {template.dentist_approval.by}</span>
            ) : (
              <span className="au-tag is-wait">Dentist approval pending</span>
            )}
          </div>
        </div>
      )}
      {err && <p className="au-error" role="alert">{err}</p>}
      <div className="au-actions">
        {canEdit && <Button size="sm" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save wording'}</Button>}
        {!dirty && !approvedByMe && <Button size="sm" variant="primary" icon="check" disabled={!!busy} onClick={approve}>{busy === 'approve' ? 'Approving…' : 'Approve this wording'}</Button>}
        {canEdit && !dirty ? <RefreshButton title="Refresh preview" ariaLabel="Refresh preview" loading={!!busy} onClick={show}/> : (canEdit || !preview) && <Button size="sm" variant="ghost" disabled={!!busy} onClick={show}>{busy === 'preview' ? 'Loading…' : canEdit ? 'Preview my changes' : 'Preview formatted email'}</Button>}
        {canEdit && showTest && <Button size="sm" variant="ghost" icon="mail" disabled={!!busy} onClick={test}>Send a test to myself</Button>}
      </div>
      {canEdit && dirty && template.approved && <p className="au-muted">Saving changes clears the approval and switches off the automations that use this email until you approve again.</p>}
    </div>
    {canEdit ? (
    <div className="au-preview">
      <div className="au-preview-header">
        <span className="au-preview-title">Patient Email Preview</span>
        <small className="au-muted">{preview ? `Subject: “${preview.subject}”` : 'Preview with example details'}</small>
      </div>
      {preview ? (
        <iframe title={`Preview: ${template.name}`} sandbox="allow-same-origin" srcDoc={preview.html}/>
      ) : (
        <div className="au-preview-empty">
          <p className="au-muted">Click "Preview formatted email" to view the rendered template as seen by patients.</p>
          <Button size="sm" variant="soft" disabled={!!busy} onClick={show}>{busy === 'preview' ? 'Loading…' : 'Generate preview'}</Button>
        </div>
      )}
    </div>
    ) : preview && (
      <details className="au-preview wording-preview" open>
        <summary>Formatted email preview</summary>
        <iframe title={`Preview: ${template.name}`} sandbox="allow-same-origin" srcDoc={preview.html}/>
      </details>
    )}
  </div>
}

/** Demo database only: make a reminder or a late release happen now so the panel can watch it. Hidden elsewhere (the server also refuses). */
function DemoClockCard({ toast, onDone }) {
  const [form, setForm] = useState({ appointment_code: '', late_code: '', invoice_number: '', summary: false })
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null)
  const run = async e => {
    e.preventDefault()
    setBusy(true)
    const r = await runAutomationDemo({ appointment_code: form.appointment_code.trim() || null, late_code: form.late_code.trim() || null, invoice_number: form.invoice_number.trim() || null, summary: form.summary })
    setBusy(false)
    if (!r.ok) return toast(r.message || 'The demo clock did not run.', 'warning')
    setResult(r.data); toast('Done.', 'success'); onDone()
  }
  const empty = !form.appointment_code.trim() && !form.late_code.trim() && !form.invoice_number.trim() && !form.summary
  return <Card className="au-demo" title="Demo clock" subtitle="Demo database only">
    <p className="au-desc">Runs one automation now as if the clock were at its due time, then sends the email at once. The real schedule will not send it again. The automation must be on.</p>
    <form className="au-form au-demo-form" onSubmit={run}>
      <Field label="Appointment code (reminder before the visit)"><input value={form.appointment_code} placeholder="APT-2026-000001" onChange={e => setForm(f => ({ ...f, appointment_code: e.target.value }))}/></Field>
      <Field label="Today’s appointment code (late: release, then offer the time)"><input value={form.late_code} placeholder="APT-2026-000002" onChange={e => setForm(f => ({ ...f, late_code: e.target.value }))}/></Field>
      <Field label="Invoice number (overdue reminder)"><input value={form.invoice_number} placeholder="INV-2026-000001" onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}/></Field>
      <label className="au-check"><input type="checkbox" checked={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.checked }))}/> Send today’s Owner summary</label>
      <div className="au-actions"><Button type="submit" size="sm" icon="clock" disabled={busy || empty}>{busy ? 'Running…' : 'Run now'}</Button></div>
    </form>
    {result && <ul className="au-result" aria-live="polite">{Object.entries(result).filter(([k]) => k !== 'emails_processed').map(([k, v]) => <li key={k}><b>{k.replace(/_/g, ' ')}</b>: simulated {manila(v.simulated_now)}{v.blocked ? ' · wording not approved' : ''}{v.enabled === false ? ' · switched off' : ''}{Object.entries(v).filter(([, x]) => typeof x === 'number').map(([n, x]) => ` · ${n.replace(/_/g, ' ')} ${x}`).join('')}</li>)}</ul>}
  </Card>
}
