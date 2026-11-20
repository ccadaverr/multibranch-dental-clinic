import React, { useEffect, useRef, useState } from 'react'
import { Button, Field, Icon, Modal } from '../../components.jsx'
import { PasswordField } from '../../pages/PasswordField.jsx'
import { getPatientRecord, myHmo, patientHome, requestPasswordReset, changePatientPassword, updateOwnProfile, saveMyHmo } from '../../api-client.js'
import { dateLong, money } from '../format.js'
import { AccountAvatar } from '../../components/AccountMenu.jsx'
import { ErrorState, PageHead, LoadingState, useLoad } from '../ui.jsx'

export function ProfilePage({ me, onNavigate, onOpenProfile, toast, onSignedOut }) {
  const id = me.patient.id
  const record = useLoad(async signal => {
    const result = await getPatientRecord(id, signal)
    return result.ok && result.data?.id !== id ? { ok: false, kind: 'stale_context', message: 'Your profile could not be verified.' } : result
  }, [id])
  const billing = useLoad(async signal => {
    const result = await patientHome(signal)
    const balance = result.data?.balance
    if (result.ok && (result.data?.patient_id !== id || !Number.isSafeInteger(balance?.minor) || !Number.isSafeInteger(balance?.count))) {
      return { ok: false, kind: 'stale_context', message: 'Your balance could not be verified.' }
    }
    return result
  }, [id])
  const [passwordOpen, setPasswordOpen] = useState(false)
  const r = record.data
  const emergency = typeof r?.emergency_contact === 'string' ? r.emergency_contact
    : [r?.emergency_contact?.name, r?.emergency_contact?.phone].filter(Boolean).join(' · ')
  const fields = r ? [
    ['Contact number', r.phone], ['Date of birth', dateLong(r.date_of_birth)], ['Address', r.address],
    ['Emergency contact', emergency], ['Preferred branch', r.preferred_branch?.name],
  ] : []
  const balance = billing.data?.balance
  return <div className="pp-page patient-account">
    <PageHead title="Account"/>
    <div className="patient-account-layout">
      <section className="patient-profile" aria-labelledby="patient-profile-title">
        <h2 id="patient-profile-title">Profile</h2>
        <div className="patient-avatar-row"><AccountAvatar accountId={me?.id} name={me?.name} large/><Button variant="soft" size="sm" onClick={onOpenProfile}>Edit name, photo & password</Button></div>
        <dl className="patient-profile-fields">
          <div><dt>Name on clinic records</dt><dd>{me.name || r?.name}</dd></div>
          <div><dt>Registered email</dt><dd>{me.email}</dd></div>
          {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || <span className="pp-muted">Not on file</span>}</dd></div>)}
        </dl>
        {record.loading && !r && <LoadingState label="Loading profile details…"/>}
        {record.error && <ErrorState text={record.error} onRetry={record.reload}/>}
        {r && <div className="patient-profile-update">
          <ContactEditor key={r.id + ':' + r.revision} record={r} reload={record.reload}/>
          <p className="pp-hint">You can update your account name from Profile. Name changes are recorded for clinic review.</p>
          <Button variant="soft" size="sm" icon="message" onClick={() => onNavigate('messages', { compose: true })}>Contact front desk</Button>
        </div>}
        <HmoDetails/>
      </section>
      <div className="patient-settings">
        <section aria-labelledby="patient-security-title">
          <h2 id="patient-security-title"><Icon name="lock" size={19}/>Security</h2>
          <p>Update your password using a verification code sent to your registered email.</p>
          <Button variant="soft" onClick={() => setPasswordOpen(true)}>Change password</Button>
        </section>
        <section aria-labelledby="patient-billing-title">
          <h2 id="patient-billing-title"><Icon name="wallet" size={19}/>Billing and payments</h2>
          {balance && (balance.count > 0 ? <p><strong className="patient-number">{money(balance.minor / 100)}</strong> outstanding across {balance.count} {balance.count === 1 ? 'invoice' : 'invoices'}.</p>
            : <p>No outstanding balance.</p>)}
          {billing.loading && !balance && <LoadingState label="Checking outstanding balance…" />}
          {billing.error && <div className="patient-balance-error" role="status"><p>Balance unavailable.</p><Button size="sm" variant="ghost" onClick={() => billing.reload()}>Retry balance</Button></div>}
          <Button variant="soft" onClick={() => onNavigate('billing')}>View billing</Button>
        </section>
        <section aria-labelledby="patient-documents-title">
          <h2 id="patient-documents-title"><Icon name="file" size={19}/>Documents</h2>
          <p>Open your saved files and consent documents.</p>
          <Button variant="soft" onClick={() => onNavigate('documents')}>View documents</Button>
        </section>
      </div>
    </div>
    <Modal open={passwordOpen} title="Change password" onClose={() => setPasswordOpen(false)}>
      <PasswordChange me={me} onSignedOut={onSignedOut}/>
    </Modal>
  </div>
}

function ContactEditor({ record, reload }) {
  const [values, setValues] = useState(null), [message, setMessage] = useState(''), [busy,setBusy] = useState(false)
  const live = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const labels = { phone: 'Contact number (+63)', address: 'Address', emergency_contact: 'Emergency contact' }
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    const result = await updateOwnProfile({ ...values, expected_revision: record.revision }, () => live.current)
    if (!live.current) return
    setBusy(false)
    if (!result.ok || result.data?.id !== record.id) { setMessage(Object.values(result.errors || {})[0]?.[0] || result.message || 'Update could not be verified.'); return }
    setValues(null); reload()
  }
  if (!values) return <Button variant="soft" onClick={() => setValues(Object.fromEntries(Object.keys(labels).map(k => [k,record[k] || ''])))}>Edit contact details</Button>
  return <form onSubmit={save}><fieldset disabled={busy}><legend>Contact details</legend>
    {Object.entries(labels).map(([k,label]) => <Field key={k} label={label}><input value={values[k]} onChange={e => setValues({ ...values, [k]: e.target.value })}/></Field>)}
    {message && <p role="alert">{message}</p>}<Button type="submit">Save changes</Button> <Button type="button" variant="ghost" onClick={() => setValues(null)}>Cancel</Button>
  </fieldset></form>
}

function HmoDetails() {
  const hmo = useLoad(myHmo, [])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const active = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const saved = hmo.data
  const values = form || { hmo_provider_name: saved?.hmo_provider_name || '', hmo_member_number: saved?.hmo_member_number || '' }
  const providers = [...new Set([...(saved?.accepted || []).map(provider => provider.name), values.hmo_provider_name].filter(Boolean))]
  const update = (key, value) => { setForm({ ...values, [key]: value }); setNote(null) }
  const save = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const result = await saveMyHmo(values)
      if (!active.current) return
      if (result.ok) setNote({ text: 'HMO details saved.' })
      else setNote({ error: true, text: Object.values(result.errors || {})[0]?.[0] || result.message || 'HMO details could not be saved.' })
    } catch {
      if (active.current) setNote({ error: true, text: 'HMO details could not be saved. Try again.' })
    } finally {
      if (active.current) setBusy(false)
    }
  }
  return <details className="patient-hmo">
    <summary>HMO details <span>Optional</span></summary>
    {hmo.loading && !saved && <LoadingState label="Loading HMO details…"/>}
    {hmo.error && <ErrorState text={hmo.error} onRetry={hmo.reload}/>}
    {saved && <form onSubmit={save} className="pp-form">
      <p className="pp-hint">The front desk checks your coverage at the clinic.</p>
      <Field label="HMO provider"><select value={values.hmo_provider_name} onChange={event => update('hmo_provider_name', event.target.value)}>
        <option value="">Select a provider</option>{providers.map(name => <option key={name}>{name}</option>)}
      </select></Field>
      <Field label="Member number"><input value={values.hmo_member_number} maxLength={60} autoComplete="off" onChange={event => update('hmo_member_number', event.target.value)}/></Field>
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save HMO details'}</Button>
      {note && <p className={note.error ? 'pp-error-text' : 'pp-hint'} role={note.error ? 'alert' : 'status'}>{note.text}</p>}
    </form>}
  </details>
}

export function SecurityPage({ me, onSignedOut, onNavigate }) {
  return <div className="pp-page patient-security">
    <PageHead title="Security" actions={<Button variant="ghost" icon="chevronLeft" onClick={() => onNavigate('profile')}>Account</Button>}/>
    <PasswordChange me={me} onSignedOut={onSignedOut}/>
  </div>
}

function PasswordChange({ me, onSignedOut }) {
  const [current, setCurrent] = useState('')
  const [step, setStep] = useState('start'), [otp, setOtp] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const send = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await requestPasswordReset(me.email)
      if (!result.ok) return setError(result.message || 'The code could not be sent. Try again.')
      setStep('code')
    } catch {
      setError('The code could not be sent. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const save = async event => {
    event.preventDefault()
    if (busy) return
    if (pw.length < 8 || !/\p{L}/u.test(pw) || !/\p{N}/u.test(pw) || pw !== pw2) {
      setError('Use at least 8 characters with a letter and a number, then enter the same password again.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await changePatientPassword({ current_password: current, otp: otp.trim(), password: pw, password_confirmation: pw2 })
      if (!result.ok) return setError(Object.values(result.errors || {})[0]?.[0] || result.message || 'The password was not changed.')
      onSignedOut({ email: me.email, message: 'Your password was changed. Please sign in with your new password.' })
    } catch {
      setError('The password change could not be confirmed. Try signing in with your new password.')
    } finally {
      setBusy(false)
    }
  }
  return <section className="patient-security-section" aria-label="Password verification">
    {step === 'start' ? <>
      <p className="pp-hint">We’ll email a code to <b>{me.email}</b> to confirm it’s you.</p>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <Button variant="soft" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send verification code'}</Button>
    </> : <form onSubmit={save} noValidate>
      <p role="status">If the code doesn’t arrive in a minute, check your spam folder.</p>
      <Field label="Code from your email" required><input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}/></Field>
      <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)}/>
      <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} hint="At least 8 characters, including a letter and a number."/>
      <PasswordField label="Confirm new password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)}
        error={pw2 && pw !== pw2 ? 'Passwords do not match.' : undefined}/>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !current || otp.length !== 6 || !pw || pw !== pw2}>{busy ? 'Saving…' : 'Save new password'}</Button>
    </form>}
  </section>
}
