import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, Field, Icon } from '../components.jsx'
import { COUNTRY_CODES, DEFAULT_COUNTRY, normalizePhoneNumber } from '../phone.js'
import { AuthShell } from './AuthShell.jsx'
import { PasswordField } from './PasswordField.jsx'
import { addCalendarMonths, clinicDate } from '../clock.js'
import { ScanIdButton } from './Join.jsx'

// Patient self-registration (M1/M4, Backend Foundation 1B). Submits to the real Laravel backend
// (`POST /api/register` via the `onRegister` prop — see App.jsx/api-client.js), which creates a pending
// Person+Patient+User in PostgreSQL and sends an email OTP. The account cannot enter the workspace until the
// OTP is verified.
//
// No "Preferred branch" field: the current backend registration contract collects no branch preference (see
// backend/README.md) — the frontend identity bridge defaults it locally, and this form does not invent one.
// The identity form intentionally collects first and last name only.
const emptyForm={first_name:'',last_name:'',email:'',date_of_birth:'',password:'',password_confirmation:''}

function PhoneField({ countryCode, localNumber, onCountryChange, onLocalNumberChange, onBlur, error }) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('')
  const numberId=useId(),hintId=`${numberId}-hint`,errorId=`${numberId}-error`
  const wrapRef=useRef(null),triggerRef=useRef(null),numberRef=useRef(null)
  useEffect(()=>{
    if(!open)return
    const close=event=>{if(!wrapRef.current?.contains(event.target))setOpen(false)}
    document.addEventListener('pointerdown',close)
    return()=>document.removeEventListener('pointerdown',close)
  },[open])
  const country=COUNTRY_CODES.find(c=>c.code===countryCode)||DEFAULT_COUNTRY
  const matches=COUNTRY_CODES.filter(c=>`${c.label} ${c.code} ${c.dial}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <div className={`field auth-phone-field ${error?'has-error':''}`}>
    <label htmlFor={numberId}>Phone number<b className="required" aria-hidden="true">*</b></label>
    <div className="phone-field">
      <div className="auth-country-wrap" ref={wrapRef} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);triggerRef.current?.focus()}}}>
        <button type="button" ref={triggerRef} className="auth-country-trigger" aria-label={`Country and calling code: ${country.label} ${country.dial}`}
          aria-expanded={open} aria-haspopup="listbox" onClick={()=>{setOpen(!open);setSearch('')}}>
          <span className="auth-country-name">{country.label}</span><b>{country.dial}</b><span aria-hidden="true">⌄</span>
        </button>
        {open&&<div className="auth-country-menu" onKeyDown={event=>{
          const options=[...event.currentTarget.querySelectorAll('[role="option"]')]
          const index=options.indexOf(document.activeElement)
          let next
          if(event.key==='ArrowDown')next=options[(index+1)%options.length]
          if(event.key==='ArrowUp')next=options[(index-1+options.length)%options.length]
          if(index>=0&&event.key==='Home')next=options[0]
          if(index>=0&&event.key==='End')next=options.at(-1)
          if(next){event.preventDefault();next.focus()}
        }}>
          <input type="search" autoFocus aria-label="Search countries" placeholder="Search country or code" value={search} onChange={e=>setSearch(e.target.value)}/>
          <div role="listbox" aria-label="Country and calling code" className="auth-country-options">
            {matches.map(c=><button type="button" role="option" aria-selected={c.code===country.code} key={c.code}
              onClick={()=>{onCountryChange(c.code);setOpen(false);setSearch('');numberRef.current?.focus()}}>{c.label} <span>{c.dial}</span></button>)}
            {!matches.length&&<p>No matching countries</p>}
          </div>
        </div>}
      </div>
      <input id={numberId} ref={numberRef} type="tel" inputMode="tel" pattern="[0-9]*" maxLength={countryCode==='PH'?10:15} aria-label="Phone number" aria-describedby={`${hintId}${error?` ${errorId}`:''}`} aria-required="true" aria-invalid={error?true:undefined}
        className="phone-field-number" placeholder={countryCode==='PH'?"9171234567":"Phone number"} autoComplete="tel-national"
        value={localNumber} onChange={e=>onLocalNumberChange(e.target.value)} onBlur={onBlur}/>
    </div>
    {error&&<small id={errorId} className="field-error" role="alert">{error}</small>}
    <small id={hintId}>{countryCode==='PH'?'Philippine mobile, e.g. 917 123 4567 (10 digits without leading 0). Used for clinic contact only.':'Used for clinic contact only.'}</small>
  </div>
}

// Client-side checks, shown inline before the server's own validation (which stays authoritative and enumeration-safe).
export const PASSWORD_RULES = [['length', 'At least 8 characters', pw => pw.length >= 8], ['letter', 'A letter', pw => /\p{L}/u.test(pw)], ['number', 'A number', pw => /\d/.test(pw)]]

/** 0–4 with a label; it only guides the patient — the server rules decide. */
export function passwordStrength(pw) {
  const value = String(pw || '')
  if (!value) return { score: 0, label: '' }
  let score = PASSWORD_RULES.filter(([, , test]) => test(value)).length >= 3 ? 2 : 1
  if (value.length >= 12) score++
  if (/[a-z]/.test(value) && /[A-Z]/.test(value) && /[^A-Za-z0-9]/.test(value)) score++
  return { score: Math.min(4, score), label: ['', 'Weak', 'Fair', 'Good', 'Strong'][Math.min(4, score)] }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Field errors for the form as typed; an empty object means it may be sent to the server. */
export function validateRegistration(form, { phoneOk = true, phoneReason = '', consent = false, today = '', minDob = '', maxDob = '' } = {}) {
  const errors = {}
  if (!form.first_name?.trim()) errors.first_name = 'Enter your first name.'
  if (!form.last_name?.trim()) errors.last_name = 'Enter your last name.'
  if (!form.date_of_birth) {
    errors.date_of_birth = 'Enter your date of birth.'
  } else {
    const effectiveMax = maxDob || today || ''
    const effectiveMin = minDob || (today ? addCalendarMonths(today, -12 * 120) : '')
    if (today && form.date_of_birth > today) {
      errors.date_of_birth = 'The date of birth cannot be in the future.'
    } else if (effectiveMax && form.date_of_birth > effectiveMax) {
      errors.date_of_birth = 'The date of birth cannot be in the future.'
    } else if (effectiveMin && form.date_of_birth < effectiveMin) {
      errors.date_of_birth = 'Date of birth must be within the last 120 years.'
    }
  }
  if (!EMAIL.test(String(form.email || '').trim())) errors.email = 'Enter a valid email address, for example name@gmail.com.'
  if (!phoneOk) errors.phone = phoneReason || 'Enter a valid phone number.'
  const pw = String(form.password || '')
  const missing = PASSWORD_RULES.filter(([, , test]) => !test(pw)).map(([, label]) => label.toLowerCase())
  if (missing.length) errors.password = `Your password needs ${missing.join(', ')}.`
  else if (pw.length > 72) errors.password = 'Use at most 72 characters.'
  if (form.password_confirmation !== pw || !pw) errors.password_confirmation = 'The passwords do not match.'
  if (!consent) errors.consent = 'Please agree to the Privacy Policy and Terms of Use to continue.'
  return errors
}

function PasswordHelp({ value }) {
  const strength = passwordStrength(value)
  return <div className="lp-pw-help">
    <div className={`lp-meter s${strength.score}`} aria-hidden="true"><span/><span/><span/><span/></div>
    <p className="lp-pw-label" aria-live="polite">{strength.label ? `Strength: ${strength.label}` : 'Use 8 or more characters with letters and numbers.'}</p>
    <ul className="lp-pw-rules">{PASSWORD_RULES.map(([key, label, test]) => <li key={key} className={test(String(value || '')) ? 'is-met' : ''}>
      <Icon name={test(String(value || '')) ? 'check' : 'x'} size={14}/>{label}<span className="sr-only">{test(String(value || '')) ? ' (done)' : ' (not yet)'}</span></li>)}</ul>
  </div>
}

export function PatientRegister({ onRegister, onCancel, connectionNotice }) {
  const [form,setForm]=useState(emptyForm)
  const [phoneLocal,setPhoneLocal]=useState('')
  const [countryCode,setCountryCode]=useState(DEFAULT_COUNTRY.code)
  const [consent,setConsent]=useState(false)
  const [errors,setErrors]=useState({})
  const [touched,setTouched]=useState({})
  const [formError,setFormError]=useState('')
  const [submitting,setSubmitting]=useState(false)
  const today=clinicDate()
  const maxDob=today
  const minDob=addCalendarMonths(today, -12 * 120)
  const formRef=useRef(null)
  const registrationAttempt=useRef(null)
  useEffect(()=>()=>{registrationAttempt.current=null},[])
  const check=(nextForm=form,nextConsent=consent,nextPhone=phoneLocal)=>{
    const phone=normalizePhoneNumber(countryCode,nextPhone)
    return validateRegistration(nextForm,{phoneOk:phone.ok,phoneReason:phone.reason,consent:nextConsent,today,minDob,maxDob})
  }
  // Inline validation: a field shows its message once the patient has left it (or tried to submit).
  const blur=key=>()=>{setTouched(t=>({...t,[key]:true}));const found=check();setErrors(e=>({...e,[key]:found[key]}))}
  const update=(key,value)=>{
    const next={...form,[key]:value}
    setForm(next)
    if(touched[key]||errors[key])setErrors(e=>({...e,[key]:check(next)[key]}))
    setFormError('')
  }
  const prefillId=({ fields })=>{
    const keys=['first_name','last_name','date_of_birth'].filter(key=>fields[key])
    const details=Object.fromEntries(keys.map(key=>[key,fields[key]]))
    const found=check({...form,...details})
    setForm(current=>({...current,...details}))
    setErrors(current=>({...current,...Object.fromEntries(keys.filter(key=>touched[key]||current[key]).map(key=>[key,found[key]]))}))
    setFormError('')
  }
  const updatePhone=rawValue=>{
    let clean=String(rawValue||'').replace(/\D/g,'')
    if(countryCode==='PH'){
      if(clean.startsWith('63')&&clean.length>10)clean=clean.slice(2)
      clean=clean.replace(/^0+/,'').slice(0,10)
    } else {
      clean=clean.slice(0,15)
    }
    setPhoneLocal(clean)
    if(touched.phone||errors.phone){
      const found=check(form,consent,clean)
      setErrors(e=>({...e,phone:found.phone}))
    }
    setFormError('')
  }
  const updateCountry=value=>{if(value!==countryCode){setCountryCode(value);setPhoneLocal('')};setErrors(e=>(e.phone?{...e,phone:undefined}:e));setFormError('')}

  const submit=async event=>{
    event.preventDefault()
    if(connectionNotice||submitting||registrationAttempt.current)return
    const found=check()
    if(Object.keys(found).length){
      setErrors(found);setTouched({first_name:true,last_name:true,date_of_birth:true,email:true,phone:true,password:true,password_confirmation:true,consent:true})
      const firstMsg=Object.values(found)[0]
      setFormError(firstMsg||'Please check the highlighted fields above.')
      requestAnimationFrame(()=>formRef.current?.querySelector('[aria-invalid="true"]')?.focus())
      return
    }
    const phone=normalizePhoneNumber(countryCode,phoneLocal)
    setSubmitting(true)
    setErrors({})
    setFormError('')
    // The server decides; its answer does not reveal whether an email already has an account (unchanged behaviour).
    const attempt={hash:window.location.hash}
    registrationAttempt.current=attempt
    const isCurrent=()=>registrationAttempt.current===attempt&&window.location.hash===attempt.hash
    const result=await onRegister({...form,phone:phone.e164},isCurrent)
    if(registrationAttempt.current!==attempt)return
    registrationAttempt.current=null
    setSubmitting(false)
    if(result?.ok)return
    if(result?.kind==='validation'){
      const fieldErrors=Object.fromEntries(Object.entries(result.errors||{}).map(([key,messages])=>[key,messages?.[0]]))
      setErrors(fieldErrors)
      if(!Object.keys(fieldErrors).length)setFormError(result.message||'Please check your details and try again.')
      return
    }
    setFormError(result?.message||'Something went wrong on our side. Please try again in a moment.')
  }

  return <AuthShell><div className="auth-form auth-register" aria-labelledby="register-title">
      <div className="lp-card-head">
        <h1 id="register-title">Create your account</h1>
        <p>Book and manage your dental visits.</p>
      </div>
      <form ref={formRef} onSubmit={submit} noValidate aria-busy={submitting} className="lp-register-form">
        <div className="lp-register-fields">
          {connectionNotice}
          <fieldset className="lp-form-group">
            <legend>Personal details</legend>
            <div className="lp-form-row">
              <Field label="First name" required error={errors.first_name}><input value={form.first_name} onChange={e=>update('first_name',e.target.value)} onBlur={blur('first_name')} autoComplete="given-name" aria-invalid={errors.first_name?true:undefined}/></Field>
              <Field label="Last name" required error={errors.last_name}><input value={form.last_name} onChange={e=>update('last_name',e.target.value)} onBlur={blur('last_name')} autoComplete="family-name" aria-invalid={errors.last_name?true:undefined}/></Field>
            </div>
            <Field label="Date of birth" required hint="Must be within the last 120 years." error={errors.date_of_birth}><input type="date" required max={maxDob} min={minDob} value={form.date_of_birth} onChange={e=>update('date_of_birth',e.target.value)} onBlur={blur('date_of_birth')} autoComplete="bday" aria-invalid={errors.date_of_birth?true:undefined}/></Field>
            <PhoneField countryCode={countryCode} localNumber={phoneLocal} onCountryChange={updateCountry} onLocalNumberChange={updatePhone} onBlur={blur('phone')} error={errors.phone}/>
            <details className="auth-id-disclosure">
              <summary>Use an ID to fill in details</summary>
              <ScanIdButton compact onResult={prefillId}/>
            </details>
          </fieldset>
          <fieldset className="lp-form-group">
            <legend>Sign-in details</legend>
            <Field label="Email" required hint="We’ll send your six-digit verification code to this address." error={errors.email}><input type="email" inputMode="email" value={form.email} onChange={e=>update('email',e.target.value)} onBlur={blur('email')} autoComplete="email" aria-invalid={errors.email?true:undefined}/></Field>
            <PasswordField label="Password" value={form.password} onChange={e=>update('password',e.target.value)} onBlur={blur('password')} autoComplete="new-password" error={errors.password} hint={<PasswordHelp value={form.password}/>}/>
            <PasswordField label="Confirm password" value={form.password_confirmation} onChange={e=>update('password_confirmation',e.target.value)} onBlur={blur('password_confirmation')} autoComplete="new-password" error={errors.password_confirmation}/>
          </fieldset>
          <div className={`lp-consent ${errors.consent?'has-error':''}`}>
            <label><input type="checkbox" checked={consent} aria-invalid={errors.consent?true:undefined} aria-describedby={errors.consent?'consent-error':undefined}
              onChange={e=>{setConsent(e.target.checked);if(errors.consent)setErrors(x=>({...x,consent:e.target.checked?undefined:x.consent}))}}/>
              <span>I agree to the <a href="#privacy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="#terms" target="_blank" rel="noreferrer">Terms of Use</a>.</span></label>
            {errors.consent&&<small id="consent-error" className="field-error" role="alert">{errors.consent}</small>}
          </div>
          {formError&&<p className="field-error auth-form-error" role="alert">{formError}</p>}
        </div>
        <div className="lp-register-actions">
          <Button type="submit" width="full" className="lp-submit" disabled={submitting||Boolean(connectionNotice)}>{submitting?'Creating your account…':'Create an account'}</Button>
          <p>Already have an account? <button type="button" className="text-link" onClick={onCancel}>Sign in</button></p>
        </div>
      </form>
  </div></AuthShell>
}
