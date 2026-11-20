import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, Field, Icon, Modal } from '../components.jsx'
import { accountPhoto, changeAccountPassword, changePatientPassword, me, removeAccountPhoto, requestPasswordReset, updateAccountName, uploadAccountPhoto } from '../api-client.js'
import { commitProfileDraft, profileChangePlan, validateProfilePhotoDimensions } from '../profile-draft.js'
import './account-menu.css'

const roleLabels = { owner: 'Owner / Admin', staff: 'Staff', dentist: 'Dentist', patient: 'Patient' }
const roleSubtitles = { owner: 'Branch oversight', staff: 'Clinic operations', dentist: 'Clinical workspace', patient: 'Your account' }
const shortName = value => String(value || '').trim().replace(/^Dr\.?\s+/i, '').split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '•'
const failureText = result => Object.values(result?.errors || {}).flat()[0] || result?.message || 'Could not verify this change. Please try again.'

/** Private photo is loaded as a blob and never exposed through a public URL or localStorage. */
export function AccountAvatar({ accountId, name, version = 0, large = false, photoOverride = null, suppressPhoto = false, onPhotoStatus }) {
  const [url, setUrl] = useState(null)
  const photoStatus = useRef(onPhotoStatus)
  photoStatus.current = onPhotoStatus
  useEffect(() => {
    if (!accountId || photoOverride || suppressPhoto) { setUrl(null); return undefined }
    const controller = new AbortController()
    let blobUrl = null
    setUrl(null)
    accountPhoto(controller.signal).then(result => {
      if (controller.signal.aborted) return
      photoStatus.current?.(result.ok ? Boolean(result.blob) : null)
      if (!result.ok || !result.blob) return
      blobUrl = URL.createObjectURL(result.blob)
      setUrl(blobUrl)
    })
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [accountId, version, photoOverride, suppressPhoto])
  return <span className={`account-avatar${large ? ' account-avatar-large' : ''}`} aria-hidden="true">
    {photoOverride || (!suppressPhoto && url) ? <img src={photoOverride || url} alt=""/> : shortName(name)}
  </span>
}

/** One bottom-left user control for every role; never adds account UI to the top bar. */
export function AccountMenu({ accountId, name, role, version = 0, onProfile, onSignOut }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return undefined
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    const esc = event => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('.account-menu-trigger')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc) }
  }, [open])
  useEffect(() => setOpen(false), [accountId])
  const action = fn => { root.current?.querySelector('.account-menu-trigger')?.focus(); setOpen(false); fn() }
  return <div className="account-menu-root" ref={root}>
    <button type="button" className="account-menu-trigger" aria-label={`Open account menu for ${name}`}
      aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(current => !current)}>
      <AccountAvatar accountId={accountId} name={name} version={version}/>
      <span className="account-menu-identity"><small className="account-menu-role">{roleLabels[role] || role}</small><b>{name}</b><small className="account-menu-subtitle">{roleSubtitles[role] || 'Your account'}</small></span>
      <Icon name="chevron" size={16}/>
    </button>
    {open && <div id={menuId} className="account-menu-popover" role="group" aria-label="Account options">
      <button type="button" onClick={() => action(onProfile)}><Icon name="user" size={18}/>Profile</button>
      <button type="button" className="account-signout-option" onClick={() => action(onSignOut)}><Icon name="logout" size={18}/>Sign out</button>
    </div>}
  </div>
}

/** X, Escape and backdrop all use the same guarded close path. */
export function AccountProfileDialog({ open, accountId, role, onClose, onUpdated, onPasswordChanged, onPhotoChanged }) {
  const editor = useRef(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmSaving, setConfirmSaving] = useState(false)
  useEffect(() => { setConfirmClose(false); setConfirmSaving(false) }, [open, accountId])
  const requestClose = () => {
    if (confirmSaving || editor.current?.isBusy()) return
    if (editor.current?.isDirty()) setConfirmClose(true)
    else onClose?.()
  }
  const cancelClose = () => { if (!confirmSaving) setConfirmClose(false) }
  const discardClose = () => { if (!confirmSaving) { setConfirmClose(false); onClose?.() } }
  const saveThenClose = async () => {
    if (confirmSaving || editor.current?.isBusy()) return
    setConfirmSaving(true)
    const done = await editor.current?.save()
    setConfirmSaving(false)
    setConfirmClose(false)
    if (done) onClose?.()
  }
  return <>
    <Modal open={open} title="Your profile" subtitle="Account details and security" onClose={requestClose} className="account-profile-dialog">
      {open && <AccountProfileEditor ref={editor} key={accountId} accountId={accountId} role={role}
        onUpdated={onUpdated} onPasswordChanged={onPasswordChanged} onPhotoChanged={onPhotoChanged}/>}
    </Modal>
    <Modal open={open && confirmClose} title="Save your changes?" subtitle="You have unsaved profile edits" onClose={cancelClose} className="account-profile-confirm">
      <p className="account-confirm-copy">Save your edits before leaving, discard them, or keep editing. Changes already saved to the clinic cannot be undone here.</p>
      <div className="account-confirm-actions">
        <Button variant="ghost" disabled={confirmSaving} onClick={cancelClose}>Keep editing</Button>
        <Button variant="soft" disabled={confirmSaving} onClick={discardClose}>Discard changes</Button>
        <Button disabled={confirmSaving} onClick={saveThenClose}>{confirmSaving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </Modal>
  </>
}

const blankPassword = () => ({ current_password: '', password: '', password_confirmation: '' })

const AccountProfileEditor = React.forwardRef(function AccountProfileEditor({ accountId, role, onUpdated, onPasswordChanged, onPhotoChanged }, ref) {
  const [current, setCurrent] = useState(null)
  const [fields, setFields] = useState({ first_name: '', last_name: '' })
  const [password, setPassword] = useState(blankPassword)
  const [otp, setOtp] = useState('')
  const [otpRequested, setOtpRequested] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [photoAction, setPhotoAction] = useState('keep')
  const [photoFile, setPhotoFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [photoVersion, setPhotoVersion] = useState(0)
  const [hasPhoto, setHasPhoto] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const fileInput = useRef(null)
  const active = useRef(false)
  const busyRef = useRef(false)
  const securityId = useId()
  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    if (!accountId) { setLoading(false); return () => { active.current = false } }
    const timer = setTimeout(() => {
      if (!active.current) return
      controller.abort()
      setMessage({ error: true, text: 'Account details took too long to load. Close and reopen your profile.' })
      setLoading(false)
    }, 12000)
    me({ signal: controller.signal }).then(result => {
      if (!active.current || controller.signal.aborted) return
      clearTimeout(timer)
      if (!result.ok || result.data?.id !== accountId || result.data?.role !== role || result.data?.account_status !== 'Active') {
        setMessage({ error: true, text: 'Account details could not be verified. Close and reopen your profile.' })
      } else {
        setCurrent(result.data)
        setFields({ first_name: result.data.first_name || '', last_name: result.data.last_name || '' })
      }
      setLoading(false)
    }).catch(() => { if (active.current && !controller.signal.aborted) { clearTimeout(timer); setMessage({ error: true, text: 'Account details could not be loaded.' }); setLoading(false) } })
    return () => { active.current = false; clearTimeout(timer); controller.abort() }
  }, [accountId, role])
  useEffect(() => {
    if (photoAction !== 'replace' || !photoFile) { setPreviewUrl(null); return undefined }
    const url = URL.createObjectURL(photoFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photoAction, photoFile])
  const owns = () => active.current && accountId === current?.id
  const plan = profileChangePlan(current, fields, photoAction, password, otp)
  const saveAll = async () => {
    if (!owns() || busyRef.current || !plan.dirty) return !plan.dirty && owns()
    busyRef.current = true
    setBusy('save')
    setMessage(null)
    if (photoAction === 'replace') {
      const photoIssue = await validateProfilePhotoDimensions(photoFile)
      if (!owns()) { busyRef.current = false; return false }
      if (photoIssue) {
        busyRef.current = false
        setBusy('')
        setMessage({ error: true, text: photoIssue })
        return false
      }
    }
    // Each successful backend operation is immediately recorded in the editor's new baseline.
    // If a later request fails, earlier saves remain truthful and are not replayed on Retry.
    const result = await commitProfileDraft({
      current, fields, photoAction, photoFile, password, otp, otpRequested, role, isCurrent: owns,
      actions: {
        name: updateAccountName,
        photoUpload: uploadAccountPhoto,
        photoRemove: removeAccountPhoto,
        password: changeAccountPassword,
        patientPassword: changePatientPassword,
      },
      onStep: (step, data) => {
        if (!owns()) return
        if (step === 'name') {
          setCurrent(data)
          setFields({ first_name: data.first_name, last_name: data.last_name })
          onUpdated?.(data)
        } else if (step === 'photo') {
          setHasPhoto(photoAction === 'replace')
          setPhotoAction('keep'); setPhotoFile(null)
          setPhotoVersion(n => n + 1)
          onPhotoChanged?.()
        } else if (step === 'password') {
          setPassword(blankPassword())
          setOtp('')
          onPasswordChanged?.({ email: current.email, message: 'Your password was changed. Sign in again with your new password.' })
        }
      },
    })
    busyRef.current = false
    if (!active.current) return false
    setBusy('')
    if (result.cancelled) return false
    if (!result.ok) {
      setMessage({ error: true, text: result.error })
      return false
    }
    if (!result.saved.includes('Password')) setMessage({ text: 'Your changes have been saved to the clinic account.' })
    return true
  }
  React.useImperativeHandle(ref, () => ({
    isDirty: () => plan.dirty,
    isBusy: () => busyRef.current,
    save: saveAll,
  }))
  const submit = event => { event.preventDefault(); void saveAll() }
  const choosePhoto = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !owns() || busyRef.current) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 2 * 1024 * 1024) {
      setMessage({ error: true, text: 'Choose a JPG, PNG or WebP image up to 2 MB.' })
      return
    }
    setPhotoFile(file)
    setPhotoAction('replace')
    setMessage(null)
  }
  const sendVerificationCode = async () => {
    if (!owns() || busyRef.current || role !== 'patient') return
    busyRef.current = true
    setBusy('verification'); setMessage(null)
    // Patient password changes keep the existing email-OTP requirement and route.
    const result = await requestPasswordReset(current.email)
    busyRef.current = false
    if (!owns()) return
    setBusy('')
    if (!result.ok) { setMessage({ error: true, text: failureText(result) }); return }
    setOtpRequested(true)
    setMessage({ text: 'Verification code requested. Check your registered email.' })
  }
  if (!accountId) return <p className="account-editor-loading" role="status">Profile settings are available after signing in.</p>
  if (loading) return <p className="account-editor-loading" role="status">Loading your account…</p>
  if (!current) return <p className="account-editor-loading" role="alert">{message?.text || 'Could not verify your account.'}</p>
  return <form className="account-editor" onSubmit={submit} noValidate>
    <fieldset className="account-editor-fieldset" disabled={!!busy}>
      <div className="account-editor-summary">
        <div className="account-photo-controls">
          <AccountAvatar accountId={accountId} name={current.name} version={photoVersion} large
            photoOverride={photoAction === 'replace' ? previewUrl : null} suppressPhoto={photoAction === 'remove'} onPhotoStatus={setHasPhoto}/>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} className="sr-only" tabIndex={-1}/>
          <button type="button" className="account-photo-add" aria-label="Choose a profile photo" title="Choose or change photo" onClick={() => fileInput.current?.click()}>
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <div className="account-editor-identity">
          <span className="account-editor-eyebrow">{roleLabels[role]}</span>
          <strong>{current.name}</strong>
          <span className="account-editor-email">{current.email}</span>
          <div className="account-photo-tools">
            {photoAction === 'remove' || photoAction === 'replace' ? <button type="button" onClick={() => { setPhotoAction('keep'); setPhotoFile(null); setMessage(null) }}>Undo photo change</button>
              : hasPhoto && <button type="button" onClick={() => { setPhotoAction('remove'); setPhotoFile(null); setMessage(null) }}>Remove photo</button>}
          </div>
        </div>
      </div>
      <p className="account-editor-photo-hint">Photo visible to your account only · JPG, PNG or WebP · up to 2 MB</p>
      <section className="account-editor-section" aria-labelledby="account-personal-title">
        <div className="account-editor-section-heading">
          <span className="account-editor-step">01</span>
          <div><h3 id="account-personal-title">Personal details</h3><p>Use your preferred name for clinic records. Changes are visible in the Owner audit trail.</p></div>
        </div>
        <div className="account-editor-two">
          <Field label="First name" required><input maxLength={80} autoComplete="given-name" value={fields.first_name} onChange={event => { setMessage(null); setFields(s => ({ ...s, first_name: event.target.value })) }}/></Field>
          <Field label="Last name" required><input maxLength={80} autoComplete="family-name" value={fields.last_name} onChange={event => { setMessage(null); setFields(s => ({ ...s, last_name: event.target.value })) }}/></Field>
        </div>
      </section>
      <section className="account-editor-section account-editor-security" aria-labelledby="account-security-title">
        <div className="account-editor-section-heading">
          <span className="account-editor-step">02</span>
          <div><h3 id="account-security-title">Password & security</h3><p>Your password stays private. Changing it signs you out of all sessions.</p></div>
        </div>
        <button type="button" className="account-security-toggle" aria-expanded={passwordOpen} aria-controls={securityId} onClick={() => setPasswordOpen(value => !value)}>
          <span className="account-security-lock"><Icon name="lock" size={20}/></span>
          <span className="account-security-label"><b>Change password</b><small>{plan.security ? 'Password edits pending' : 'Keep your clinic account secure'}</small></span>
          <Icon name="chevron" size={17} className={passwordOpen ? 'account-security-expanded' : ''}/>
        </button>
        <div className="account-security-form" id={securityId} hidden={!passwordOpen}>
          {role === 'patient' && <div className="account-editor-verification">
            <span>Verify with the email address registered to your account.</span>
            <Button size="sm" variant="soft" type="button" disabled={!!busy} onClick={sendVerificationCode}>{busy === 'verification' ? 'Sending…' : otpRequested ? 'Resend code' : 'Send verification code'}</Button>
            <Field label="Code from email"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={event => { setMessage(null); setOtp(event.target.value.replace(/\D/g, '')) }}/></Field>
          </div>}
          <Field label="Current password"><input autoComplete="current-password" type="password" value={password.current_password} onChange={event => { setMessage(null); setPassword(s => ({ ...s, current_password: event.target.value })) }}/></Field>
          <Field label="New password" hint="At least 8 characters, with a letter and a number."><input autoComplete="new-password" type="password" value={password.password} onChange={event => { setMessage(null); setPassword(s => ({ ...s, password: event.target.value })) }}/></Field>
          <Field label="Confirm new password"><input autoComplete="new-password" type="password" value={password.password_confirmation} onChange={event => { setMessage(null); setPassword(s => ({ ...s, password_confirmation: event.target.value })) }}/></Field>
        </div>
      </section>
    </fieldset>
    <div className="account-editor-footer">
      <div className="account-editor-footer-status" aria-live="polite">{message ? <p className={`account-editor-feedback${message.error ? ' is-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>
        : <span>{plan.dirty ? 'Unsaved changes' : 'Everything is up to date'}</span>}</div>
      <Button type="submit" disabled={!!busy || !plan.dirty}>{busy === 'save' ? 'Saving…' : 'Save changes'}</Button>
    </div>
  </form>
})
