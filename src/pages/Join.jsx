import React, { useEffect, useRef, useState } from 'react'
import { Button, Field, Icon, Notice, SelectWithOther } from '../components.jsx'
import { AuthShell } from './AuthShell.jsx'
import { intakeBranch, joinQueueWithAccount, myDependents, submitIntake } from '../api-client.js'
import { addCalendarMonths, clinicDate } from '../clock.js'

/** `#join/<branch>` (counter poster QR). */
export function parseJoinHash(hash) {
  const m = /^#join\/([A-Za-z0-9_-]{1,50})(?:\/([A-Za-z0-9]{4,12}))?$/.exec(hash || '')
  return m ? { mode: 'join', branch: m[1], code: m[2] || '' } : null
}

const WHY = {
  name: 'Your legal name, as on your ID, so the record and receipts are yours.',
  date_of_birth: 'Tells patients apart, and a patient under 18 needs a parent or guardian.',
  phone: 'So the front desk can reach you about your visit.',
  email: 'Optional. Only to email confirmations and to create an online account later.',
  address: 'Optional. For your patient record.',
  emergency: 'Who we call if something happens during your visit.',
}
const blank = { first_name: '', last_name: '', date_of_birth: '', sex: '', phone: '', email: '', address: '', emergency_contact: { name: '', phone: '' } }
const firstError = r => (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message) || 'That did not work. Please try again or ask the front desk.'

/**
 * Counter registration on the patient's own phone, replacing the paper form staff retype (R2-03, R2-05). Two
 * choices: "I'm new here" (the form) or "I have an account" (sign in). Both end with "Join today's queue", which needs the code
 * shown at the front desk today. Collects only what the paper form needs, says why for each field, and asks for consent.

 */
export function JoinPage({ hash, signedInPatient = false }) {
  const [link] = useState(() => parseJoinHash(hash))
  const [branch, setBranch] = useState(null), [error, setError] = useState('')
  const [step, setStep] = useState(signedInPatient ? 'account' : 'choose')
  const [done, setDone] = useState(null)
  const [resetKey, setResetKey] = useState(0)

  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!link) return
    setError('')
    intakeBranch(link.branch).then(r => {
      if (r.ok) return setBranch(r.data)
      // A missing branch is a bad link; anything else (offline, server busy) can be retried.
      setError(r.kind === 'not_found' ? 'invalid' : 'offline')
    })
  }, [link?.branch, attempt])
  if (!link) return <AuthShell><Notice tone="warning" title="Link not recognised">Scan the code on the counter poster again, or ask the front desk.</Notice></AuthShell>

  return <AuthShell><div className="auth-form join-page" key={resetKey} aria-live="polite">
    <div className="login-copy-wrap"><div className="eyebrow">{branch ? branch.name : 'Clinic'}</div>
      <h1>{done ? 'You’re registered' : step === 'new' ? 'Register at the counter' : 'Welcome'}</h1></div>
    {error === 'invalid' ? <Notice tone="warning" title="Link not recognised">This branch link is not valid. Scan the code on the counter poster again, or ask the front desk.</Notice>
      : error ? <Notice tone="warning" title="Can’t reach the clinic">Check the phone’s internet connection. <button type="button" className="link-button" onClick={() => setAttempt(a => a + 1)}>Try again</button></Notice>
      : !branch ? <p className="login-copy" role="status">Loading…</p>
      : done ? <Done result={done}/>
      : step === 'choose' ? <div className="join-choices">
        <button type="button" className="join-choice" onClick={() => setStep('new')}><Icon name="user" size={26}/><b>I’m new here</b><small>Fill in your details on your phone instead of the paper form.</small></button>
        <button type="button" className="join-choice" onClick={() => { try { sessionStorage.setItem('join-branch', link.branch) } catch { /* private mode */ } window.location.hash = 'sign-in' }}>
          <Icon name="lock" size={26}/><b>I have an account</b><small>Sign in, then join today’s queue.</small></button>
      </div>
      : step === 'account' ? <AccountJoin branch={link.branch} code={link.code} onDone={setDone}/>
        : branch && <IntakeForm branch={branch} code={link.code} onDone={setDone} onBack={() => setStep('choose')}/>}
  </div></AuthShell>
}

function Done({ result }) {
  return <div className="join-done">
    <Notice tone="success" title={result.join_queue === false ? 'Registered' : 'You’re on today’s list'}>{result.message}</Notice>
    <p className="join-ref">Reference <b>{result.reference}</b></p>
    <p className="login-copy">Show your valid ID at the front desk. They check it once and confirm your details. Your ID was not uploaded or kept.</p>
  </div>
}

/** Signed-in patient: join today's queue (for themselves or a dependent) with the code shown at the front desk. */
export function AccountJoin({ branch, code: initialCode, onDone }) {
  const [code, setCode] = useState(initialCode), [forId, setForId] = useState('self'), [people, setPeople] = useState([]), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  useEffect(() => { myDependents().then(r => { if (r.ok) setPeople(r.data || []) }) }, [])
  const go = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    const r = await joinQueueWithAccount({ branch_ref: branch, code, visit_for: forId })
    setBusy(false)
    if (!r.ok) return setErr(firstError(r))
    try { sessionStorage.removeItem('join-branch') } catch { /* private mode */ }
    onDone(r.data)
  }
  return <form className="join-form" onSubmit={go}>
    {people.length > 0 && <Field label="Who is the visit for?"><select value={forId} onChange={e => setForId(e.target.value)}>
      <option value="self">Me</option>{people.map(p => <option key={p.id} value={p.id}>{p.first_name} ({p.relationship.toLowerCase()})</option>)}
    </select></Field>}
    <CodeField value={code} onChange={setCode}/>
    {err && <p className="pp-error-text" role="alert">{err}</p>}
    <Button type="submit" width="full" disabled={busy || code.trim().length < 4}>{busy ? 'Joining…' : 'Join today’s queue'}</Button>
  </form>
}

function CodeField({ value, onChange }) {
  return <Field label="Today’s code at the front desk" required hint="Shown on the front-desk screen. It changes every day, so you can only join while you are here.">
    <input value={value} onChange={e => onChange(e.target.value.toUpperCase())} inputMode="text" autoComplete="off" autoCapitalize="characters" maxLength={8} placeholder="e.g. 4KX7QM" className="join-code"/>
  </Field>
}

function IntakeForm({ branch, code: initialCode, onDone, onBack }) {
  const [self, setSelf] = useState(blank), [deps, setDeps] = useState([]), [visitFor, setVisitFor] = useState('self')
  const [joinQueue, setJoinQueue] = useState(true), [code, setCode] = useState(initialCode), [consent, setConsent] = useState(false)
  const [scan, setScan] = useState(null), [busy, setBusy] = useState(false), [errors, setErrors] = useState({}), [message, setMessage] = useState('')
  const today = clinicDate()
  const maxDob = today
  const minDob = addCalendarMonths(today, -12 * 120)
  const set = (k, v) => setSelf(s => ({ ...s, [k]: v }))
  const fromId = k => scan?.fields?.includes(k)
  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErrors({}); setMessage('')
    const r = await submitIntake({ branch_ref: branch.id, code, consent, channel: 'phone', join_queue: joinQueue, visit_for: visitFor,
      self: { ...self, email: self.email.trim() || null, sex: self.sex || null }, dependents: deps.map(({ relationship_other, ...d }) => ({ ...d, ...(d.relationship === 'Other' ? { relationship_other: (relationship_other || '').trim() } : {}) })),
      ...(scan ? { scan: { id_type: scan.id_type, fields: scan.fields } } : {}) })
    setBusy(false)
    if (!r.ok) { setErrors(r.errors || {}); setMessage(r.kind === 'rate_limited' ? 'Too many tries from this phone. Please wait a minute or ask the front desk.' : firstError(r)); return }
    onDone(r.data)
  }
  const err = k => errors[k]?.[0]
  return <form className="join-form" onSubmit={submit} noValidate>
    <Notice tone="info" title="Why we ask">We collect only what the clinic’s paper form asks for, to register you as a patient and contact you about your care (Data Privacy Act of 2012). Your ID is checked once by the front desk; a photo of it is never uploaded or kept.</Notice>
    <ScanIdButton onResult={r => { setScan({ id_type: r.id_type, fields: Object.keys(r.fields).filter(k => r.fields[k]) }); setSelf(s => ({ ...s, ...Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v)) })) }}/>
    <fieldset className="join-fieldset"><legend>About you</legend>
      <div className="join-row">
        <Field label="First name" required error={err('self.first_name')} hint={fromId('first_name') ? 'From your ID, please check' : WHY.name}><input className={fromId('first_name') ? 'from-id' : ''} value={self.first_name} onChange={e => set('first_name', e.target.value)} autoComplete="given-name"/></Field>
        <Field label="Last name" required error={err('self.last_name')} hint={fromId('last_name') ? 'From your ID, please check' : null}><input className={fromId('last_name') ? 'from-id' : ''} value={self.last_name} onChange={e => set('last_name', e.target.value)} autoComplete="family-name"/></Field>
      </div>
      <div className="join-row">
        <Field label="Date of birth" required error={err('self.date_of_birth')} hint={fromId('date_of_birth') ? 'From your ID, please check' : WHY.date_of_birth}><input className={fromId('date_of_birth') ? 'from-id' : ''} type="date" min={minDob} max={maxDob} value={self.date_of_birth} onChange={e => set('date_of_birth', e.target.value)}/></Field>
        <Field label="Sex"><select value={self.sex} onChange={e => set('sex', e.target.value)}><option value="">Prefer not to say</option><option>Female</option><option>Male</option></select></Field>
      </div>
      <Field label="Mobile number" required error={err('self.phone')} hint={WHY.phone}><input type="tel" inputMode="tel" value={self.phone} onChange={e => set('phone', e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10))} maxLength={10} placeholder="9171234567" autoComplete="tel"/></Field>
      <Field label="Email (optional)" error={err('self.email')} hint={WHY.email}><input type="email" value={self.email} onChange={e => set('email', e.target.value)} autoComplete="email"/></Field>
      <Field label="Address (optional)" error={err('self.address')} hint={WHY.address}><input value={self.address} onChange={e => set('address', e.target.value)} autoComplete="street-address"/></Field>
    </fieldset>
    <fieldset className="join-fieldset"><legend>Emergency contact</legend>
      <p className="join-why">{WHY.emergency}</p>
      <div className="join-row">
        <Field label="Name" required error={err('self.emergency_contact.name')}><input value={self.emergency_contact.name} onChange={e => set('emergency_contact', { ...self.emergency_contact, name: e.target.value })}/></Field>
        <Field label="Mobile number" required error={err('self.emergency_contact.phone')}><input type="tel" inputMode="tel" value={self.emergency_contact.phone} onChange={e => set('emergency_contact', { ...self.emergency_contact, phone: e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10) })} maxLength={10} placeholder="9171234567"/></Field>
      </div>
    </fieldset>
    <Dependents deps={deps} setDeps={setDeps} errors={errors} minDob={minDob} maxDob={maxDob}/>
    <fieldset className="join-fieldset"><legend>Today</legend>
      <label className="au-check"><input type="checkbox" checked={joinQueue} onChange={e => setJoinQueue(e.target.checked)}/> Join today’s queue (walk-in)</label>
      {joinQueue && deps.length > 0 && <Field label="Who is the visit for?"><select value={visitFor} onChange={e => setVisitFor(e.target.value)}>
        <option value="self">Me</option>{deps.map((d, i) => <option key={i} value={`dependent:${i}`}>{d.first_name || `Dependent ${i + 1}`}</option>)}
      </select></Field>}
      <CodeField value={code} onChange={setCode}/>
      {err('code') && <p className="pp-error-text" role="alert">{err('code')}</p>}
    </fieldset>
    <label className="au-check join-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>
      <span>I agree that the clinic keeps these details for my dental care and may contact me about my visits, as explained in the <a href="#privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.{deps.length ? ' I am the parent or guardian of the people I added and agree for them too.' : ''}</span></label>
    {err('consent') && <p className="pp-error-text" role="alert">Please agree to the privacy notice to register.</p>}
    {message && <p className="pp-error-text" role="alert">{message}</p>}
    <Button type="submit" width="full" disabled={busy || !consent || deps.some(d => d.relationship === 'Other' && !(d.relationship_other || '').trim())}>{busy ? 'Sending…' : joinQueue ? 'Register and join today’s queue' : 'Register'}</Button>
    <button type="button" className="link-button join-back" onClick={onBack}>Back</button>
  </form>
}

function Dependents({ deps, setDeps, errors, minDob, maxDob }) {
  const add = () => setDeps(d => [...d, { first_name: '', last_name: '', date_of_birth: '', sex: '', relationship: 'Child', relationship_other: '' }])
  const set = (i, k, v) => setDeps(d => d.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  return <fieldset className="join-fieldset"><legend>Children or others in your care</legend>
    <p className="join-why">Under 18? A parent or guardian registers them here. They need no ID or email: your ID is the one checked.</p>
    {deps.map((d, i) => <div className="join-dep" key={i}>
      <div className="join-row">
        <Field label="First name" required error={errors[`dependents.${i}.first_name`]?.[0]}><input value={d.first_name} onChange={e => set(i, 'first_name', e.target.value)}/></Field>
        <Field label="Last name" required error={errors[`dependents.${i}.last_name`]?.[0]}><input value={d.last_name} onChange={e => set(i, 'last_name', e.target.value)}/></Field>
      </div>
      <div className="join-row">
        <Field label="Date of birth" required error={errors[`dependents.${i}.date_of_birth`]?.[0]}><input type="date" min={minDob} max={maxDob} value={d.date_of_birth} onChange={e => set(i, 'date_of_birth', e.target.value)}/></Field>
        <SelectWithOther label="Relationship" required value={d.relationship} onChange={v => set(i, 'relationship', v)} options={['Child', 'Daughter', 'Son', 'Grandchild', 'Ward', 'Parent', 'Other']} otherValue={d.relationship_other} onOtherChange={v => set(i, 'relationship_other', v)} placeholder="e.g., Niece, Nephew, Cousin" error={errors[`dependents.${i}.relationship_other`]?.[0] || errors[`dependents.${i}.relationship`]?.[0]}/>
      </div>
      <button type="button" className="link-button" onClick={() => setDeps(x => x.filter((_, j) => j !== i))}>Remove</button>
    </div>)}
    {deps.length < 6 && <Button size="sm" variant="soft" icon="plusCalendar" onClick={add}>Add a child or dependent</Button>}
  </fieldset>
}

/**
 * Optional "Scan your ID to fill this in". A consent step first; then the photo is read ON THIS DEVICE (the scan module is a
 * separate chunk loaded only now) and dropped. Only the name parts and birth date are filled in, highlighted for checking.
 */
export function ScanIdButton({ onResult, compact = false }) {
  const [phase, setPhase] = useState('idle'), [progress, setProgress] = useState(0), [note, setNote] = useState('')
  const input = useRef(null)
  const read = async file => {
    if (!file) return
    setPhase('reading'); setProgress(0); setNote('')
    try {
      const [{ scanId }, { scanVerdict }] = await Promise.all([import('../intake/id-scan.js'), import('../intake/id-parse.js')])
      const result = await scanId(file, { onProgress: p => setProgress(Math.round(p * 100)) })
      const verdict = scanVerdict(result)
      setNote(verdict.message)
      if (verdict.ok) onResult(result)
      setPhase(verdict.ok ? 'done' : 'poor')
    } catch {
      setNote('We couldn’t read it clearly, please type it.'); setPhase('poor')
    } finally { if (input.current) input.current.value = '' }
  }
  return <div className="scan-id">
    {phase === 'idle' && <Button variant={compact ? 'ghost' : 'soft'} icon={compact ? undefined : 'sparkles'} width={compact ? undefined : 'full'} onClick={() => setPhase('consent')}>{compact ? 'Scan ID (optional)' : 'Scan your ID to fill this in (optional)'}</Button>}
    {phase === 'consent' && <div className="scan-consent" role="region" aria-label="About the ID scan">
      <p><b>Before you scan</b></p>
      <ul><li>We read only your <b>name and date of birth</b> from the ID, to fill in this form.</li>
        <li>It is read <b>on this phone</b>. The photo is not uploaded and not kept, and your ID number is not read or stored.</li>
        <li>You check and can change everything before sending. Skipping is fine.</li></ul>
      <div className="pp-actions">
        <Button icon="checkin" onClick={() => input.current?.click()}>I agree, scan my ID</Button>
        <Button variant="ghost" onClick={() => setPhase('idle')}>Type it instead</Button>
      </div>
    </div>}
    <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={e => read(e.target.files?.[0])}/>
    {phase === 'reading' && <p role="status" className="scan-progress">Reading your ID on this phone… {progress ? `${progress}%` : ''}</p>}
    {(phase === 'done' || phase === 'poor') && <p role="status" className={`scan-note ${phase === 'poor' ? 'is-poor' : ''}`}>{note} <button type="button" className="link-button" onClick={() => setPhase('consent')}>Scan again</button></p>}
  </div>
}
