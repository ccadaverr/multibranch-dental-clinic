import React, { useEffect, useRef, useState } from 'react'
import { Button, Field, Icon } from '../../components.jsx'
import { PasswordField } from '../../pages/PasswordField.jsx'
import { confirmEmailChange, getPatientRecord, myHmo, requestEmailChange, requestPasswordReset, resetPassword, saveMyHmo } from '../../api-client.js'
import { dateLong, initials } from '../format.js'
import { ErrorState, PageHead, Skeleton, useLoad } from '../ui.jsx'

function AvatarUpload({ me, toast }) {
  const [avatar, setAvatar] = useState(() => {
    try {
      return localStorage.getItem(`patient_avatar_${me?.patient?.id || me?.id}`) || null
    } catch { return null }
  })
  const fileInputRef = useRef(null)

  const onFileChange = e => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast?.('Please select an image file (JPG, PNG, or WebP).', 'warning')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast?.('Image must be under 2MB.', 'warning')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUri = reader.result
      try {
        localStorage.setItem(`patient_avatar_${me?.patient?.id || me?.id}`, dataUri)
        setAvatar(dataUri)
        window.dispatchEvent(new CustomEvent('patient-avatar-updated', { detail: dataUri }))
        toast?.('Profile picture updated successfully.', 'success')
      } catch {
        toast?.('Could not save photo to browser storage.', 'warning')
      }
    }
    reader.readAsDataURL(file)
  }

  const removeAvatar = () => {
    try {
      localStorage.removeItem(`patient_avatar_${me?.patient?.id || me?.id}`)
      setAvatar(null)
      window.dispatchEvent(new CustomEvent('patient-avatar-updated', { detail: null }))
      toast?.('Profile picture removed.', 'info')
    } catch { /* noop */ }
  }

  return <section className="pp-card pp-fade" aria-labelledby="pp-photo-title">
    <p className="pp-eyebrow" id="pp-photo-title">Profile picture</p>
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
      <div style={{ width: '68px', height: '68px', borderRadius: '50%', overflow: 'hidden', background: 'var(--brand-soft)', display: 'grid', placeItems: 'center', flexShrink: 0, border: '2px solid var(--brand)' }}>
        {avatar ? <img src={avatar} alt="Profile preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/> : <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--brand-3)' }}>{initials(me?.name || 'Patient')}</span>}
      </div>
      <div>
        <b style={{ display: 'block', fontSize: '0.9375rem', color: 'var(--ink)' }}>Upload your profile photo</b>
        <p style={{ margin: '2px 0 8px', fontSize: '0.8125rem', color: 'var(--muted)' }}>Supports JPG, PNG, or WebP up to 2MB.</p>
        <input type="file" ref={fileInputRef} accept="image/png, image/jpeg, image/webp" onChange={onFileChange} style={{ display: 'none' }}/>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="sm" variant="soft" icon="upload" onClick={() => fileInputRef.current?.click()}>{avatar ? 'Change photo' : 'Upload photo'}</Button>
          {avatar && <Button size="sm" variant="ghost" className="pp-danger" onClick={removeAvatar}>Remove</Button>}
        </div>
      </div>
    </div>
  </section>
}

/**
 * Profile (decision 2): the legal name is read-only for Patients. Staff correct it (audited), and issued invoices and receipts keep
 * the name they were issued to. The other details are shown as recorded by the clinic.
 */
export function ProfilePage({ me, onNavigate, toast }) {
  const record = useLoad(() => getPatientRecord(me.patient.id), [me.patient.id])
  const r = record.data
  const rows = r ? [['Date of birth', r.date_of_birth ? dateLong(r.date_of_birth) : null], ['Mobile number', r.phone], ['Address', r.address],
    ['Emergency contact', typeof r.emergency_contact === 'string' ? r.emergency_contact : [r.emergency_contact?.name, r.emergency_contact?.phone].filter(Boolean).join(' · ') || null],
    ['Preferred branch', r.preferred_branch?.name]] : []
  return <div className="pp-page">
    <PageHead eyebrow="Your account" title="Profile"/>
    <AvatarUpload me={me} toast={toast}/>
    {record.status === 'loading' && <Skeleton lines={5} label="Loading your profile"/>}
    {record.status === 'error' && <ErrorState text={record.error} onRetry={record.reload}/>}
    {r && <section className="pp-card pp-fade" aria-labelledby="pp-name">
      <p className="pp-eyebrow">Legal name</p>
      <h2 id="pp-name" className="pp-name">{r.name}</h2>
      <p className="pp-hint"><Icon name="lock" size={14}/> Your name appears on invoices and receipts, so only the clinic can change it.</p>
      <Button size="sm" variant="soft" icon="message" onClick={() => onNavigate('messages', { compose: true, text: `Hello, I need to correct my name on my clinic record. It should be: ` })}>Need to correct your name? Message the front desk</Button>
      <dl className="pp-summary">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || <span className="pp-muted">Not on file</span>}</dd></div>)}</dl>
      <p className="pp-hint">To update these details, message the front desk or tell them at your next visit.</p>
    </section>}
    <HmoDetails/>
    <section className="pp-card pp-fade" aria-labelledby="pp-family-link"><p className="pp-eyebrow" id="pp-family-link">Family & dependents</p>
      <p className="pp-hint">Manage children or dependents in your care for booking and reminders.</p>
      <button type="button" className="link-button" onClick={() => onNavigate('family')}>Open Family</button></section>
    <section className="pp-card pp-fade">
      <p className="pp-eyebrow">Sign-in email</p>
      <p className="pp-email">{me.email}</p>
      <Button size="sm" variant="ghost" icon="lock" onClick={() => onNavigate('security')}>Change in Account security</Button>
    </section>
  </div>
}

/** F8: the patient's own HMO provider and member number (optional), for the front desk to check at the visit. No claims here. */
function HmoDetails() {
  const [form, setForm] = useState(null), [accepted, setAccepted] = useState([]), [busy, setBusy] = useState(false), [note, setNote] = useState('')
  useEffect(() => { myHmo().then(r => { if (r.ok) { setForm({ hmo_provider_name: r.data.hmo_provider_name || '', hmo_member_number: r.data.hmo_member_number || '' }); setAccepted(r.data.accepted || []) } }) }, [])
  if (!form) return null
  const save = async e => {
    e.preventDefault()
    setBusy(true); setNote('')
    const r = await saveMyHmo(form)
    setBusy(false)
    setNote(r.ok ? 'Saved. The front desk will check your coverage at your visit.' : (r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] : r.message) || 'Not saved.')
  }
  return <section className="pp-card pp-fade" aria-labelledby="pp-hmo">
    <p className="pp-eyebrow" id="pp-hmo">HMO (optional)</p>
    <p className="pp-hint">If you have an HMO card, add it here. Coverage is checked at the clinic; nothing is claimed online.{accepted.length ? ` HMOs the clinic has confirmed: ${accepted.map(h => h.name + (h.branch ? ` (${h.branch})` : '')).join(', ')}.` : ''}</p>
    <form onSubmit={save} className="pp-form">
      <Field label="HMO provider"><select value={form.hmo_provider_name} onChange={e => setForm(f => ({ ...f, hmo_provider_name: e.target.value }))}><option value="">Select HMO provider (optional)</option>{['Intellicare', 'Avega', 'InLife iCare', 'eTiQa', 'Dental Network'].map(name => <option key={name} value={name}>{name}</option>)}{form.hmo_provider_name && !['Intellicare', 'Avega', 'InLife iCare', 'eTiQa', 'Dental Network'].includes(form.hmo_provider_name) && <option value={form.hmo_provider_name}>{form.hmo_provider_name}</option>}</select></Field>
      <Field label="Member number"><input value={form.hmo_member_number} maxLength={60} autoComplete="off" onChange={e => setForm(f => ({ ...f, hmo_member_number: e.target.value }))}/></Field>
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save HMO details'}</Button>
      {note && <p className="pp-hint" role="status">{note}</p>}
    </form>
  </section>
}

/** Account security (decision 3): changing the sign-in email needs the current password (checked by the server), then a code sent to the new address. */
export function SecurityPage({ me, onSignedOut }) {
  return <div className="pp-page">
    <PageHead eyebrow="Your account" title="Account security" text="Changes here sign you out everywhere, so you’ll sign in again with your new details."/>
    <EmailChange me={me} onSignedOut={onSignedOut}/>
    <PasswordChange me={me} onSignedOut={onSignedOut}/>
  </div>
}

function EmailChange({ me, onSignedOut }) {
  const [step, setStep] = useState('form'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const fail = r => setError(r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message || 'That did not work. Try again.')
  const send = async e => {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    const r = await requestEmailChange({ newEmail: email.trim(), currentPassword: password })
    setBusy(false); setPassword('')
    if (!r.ok) return fail(r)
    setStep('code')
  }
  const confirm = async e => {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    const r = await confirmEmailChange(otp.trim())
    setBusy(false)
    if (!r.ok) return fail(r)
    onSignedOut({ email: r.data?.email || email.trim(), message: 'Your sign-in email was changed. Please sign in with your new email.' })
  }
  return <section className="pp-card pp-fade" aria-labelledby="pp-email-title">
    <h2 id="pp-email-title"><Icon name="mail" size={20}/> Sign-in email</h2>
    <p className="pp-hint">Currently <b>{me.email}</b>. We’ll send a code to the new address and a security notice to this one.</p>
    {step === 'form' ? <form onSubmit={send} noValidate>
      <Field label="New email" required><input type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }}/></Field>
      <PasswordField label="Current password" autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError('') }}/>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !email.trim() || !password}>{busy ? 'Sending…' : 'Send code to new email'}</Button>
    </form> : <form onSubmit={confirm} noValidate>
      <p role="status">We sent a 6-digit code to <b>{email.trim()}</b>.</p>
      <Field label="Code" required><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError('') }}/></Field>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <div className="form-actions"><Button variant="ghost" onClick={() => { setStep('form'); setOtp(''); setError('') }}>Use a different email</Button><Button type="submit" disabled={busy || otp.length !== 6}>{busy ? 'Confirming…' : 'Confirm new email'}</Button></div>
    </form>}
  </section>
}

function PasswordChange({ me, onSignedOut }) {
  const [step, setStep] = useState('start'), [otp, setOtp] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const send = async () => {
    setBusy(true); setError('')
    const r = await requestPasswordReset(me.email)
    setBusy(false)
    if (!r.ok) return setError(r.message || 'The code could not be sent. Try again.')
    setStep('code')
  }
  const save = async e => {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    const r = await resetPassword({ email: me.email, otp: otp.trim(), password: pw, passwordConfirmation: pw2 })
    setBusy(false)
    if (!r.ok) return setError(r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message || 'The password was not changed.')
    onSignedOut({ email: me.email, message: 'Your password was changed. Please sign in with your new password.' })
  }
  return <section className="pp-card pp-fade" aria-labelledby="pp-pw-title">
    <h2 id="pp-pw-title"><Icon name="lock" size={20}/> Password</h2>
    {step === 'start' ? <>
      <p className="pp-hint">We’ll email a code to <b>{me.email}</b> to confirm it’s you.</p>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <Button variant="soft" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Change password'}</Button>
    </> : <form onSubmit={save} noValidate>
      <p role="status">If the code doesn’t arrive in a minute, check your spam folder.</p>
      <Field label="Code from your email" required><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}/></Field>
      <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)}/>
      <PasswordField label="Confirm new password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)}/>
      {error && <p className="pp-error-text" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || otp.length !== 6 || !pw || pw !== pw2}>{busy ? 'Saving…' : 'Save new password'}</Button>
    </form>}
  </section>
}
