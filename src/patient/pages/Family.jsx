import React, { useEffect, useRef, useState } from 'react'
import { Button, Field, SelectWithOther } from '../../components.jsx'
import { inviteToClaim, myDependents } from '../../api-client.js'

import {ErrorState,Skeleton} from '../ui.jsx'
import {boundedDependent,createDependentCommand,dependentReady,dependentRecoveryStore} from '../dependent-command.js'

/**
 * Parents and guardians (R2-12): children or others in your care. You book, are reminded and pay for them; they need no ID or
 * email. At 18 you can invite them to claim their own account, and then you no longer manage their record.
 */
/** The Family page of the portal (reachable from the navigation). */
export function FamilyPage(props) {
  return <div className="pp-page"><Family {...props}/></div>
}

export function Family({session,getAuthGeneration}) {
  const [rows, setRows] = useState(null), [adding, setAdding] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', date_of_birth: '', relationship: 'Child', relationship_other: '', consent: false })
  const [inviting, setInviting] = useState(null), [inviteEmail, setInviteEmail] = useState('')
  const [loadError,setLoadError]=useState(''),[attempt,setAttempt]=useState(0),[capable,setCapable]=useState(false),[uncertain,setUncertain]=useState(false)
  const alive=useRef(false),latest=useRef(null),flight=useRef(false),command=useRef(null),recovery=useRef(null)
  const generation=getAuthGeneration?.(),owner=JSON.stringify([session?.serverUserId,session?.patientPublicId,generation]);latest.current=owner
  const owns=()=>alive.current&&latest.current===owner&&session?.active===true&&session?.role==='patient'&&(!getAuthGeneration||generation!=null&&getAuthGeneration()===generation)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    let current=true;setRows(null);setLoadError('');setCapable(false)
    if(!owns()){setLoadError('Your Family session is unavailable. Sign in again.');return}
    boundedDependent(()=>myDependents()).then(r=>{
      if(!current||!owns())return
      if(!r.ok||!Array.isArray(r.data)||r.meta?.me?.id!==session.patientPublicId)return setLoadError(r.message||'The authorized Family record could not be verified.')
      setRows(r.data);setCapable(dependentReady(r,session.patientPublicId))
    })
    try{recovery.current=dependentRecoveryStore(session?.serverUserId,session?.patientPublicId);const key=recovery.current.read();if(key&&!command.current){command.current=createDependentCommand({guardianId:session.patientPublicId,key,isCurrent:owns});setUncertain(true);setNote('An earlier dependent creation is unconfirmed. Recover its original result before adding another Patient.')}}catch{setNote('Browser recovery storage is unavailable. Enable site storage before adding a dependent.')}
    return()=>{current=false}
  },[attempt,owner])
  const reload=()=>setAttempt(a=>a+1)
  const finish=async r=>{
    if(!owns())return
    if(r.verified){
      try{recovery.current.clear()}catch{setNote('Dependent '+r.data.code+' is saved, but its browser recovery marker could not be cleared. Reload Family before another addition.');setUncertain(true);return}
      command.current=null;setUncertain(false);setAdding(false);setForm({first_name:'',last_name:'',date_of_birth:'',relationship:'Child',relationship_other:'',consent:false});setNote('Dependent '+r.data.code+' creation verified. Reloading your current Family records.');reload()
    }else if(r.refused){try{recovery.current.clear()}catch{}command.current=null;setNote((r.kind==='validation'?Object.values(r.errors||{})[0]?.[0]:r.message)||'The dependent was not added. Review the entered fields.');setUncertain(false)}
    else if(!r.obsolete&&!r.duplicate){setUncertain(true);setNote(r.message||'The saved outcome remains unconfirmed. Retry the same operation or recover its result.')}
  }
  const add = async e => {
    e.preventDefault()
    if(flight.current||!owns()||!capable||uncertain)return
    const payload={...form,first_name:form.first_name.trim(),last_name:form.last_name.trim(),relationship_other:form.relationship==='Other'?form.relationship_other.trim():''}
    if(!payload.first_name||!payload.last_name||payload.relationship==='Other'&&!payload.relationship_other)return setNote('Enter the required names and Specify relationship before saving.')
    const pending=createDependentCommand({guardianId:session.patientPublicId,payload,isCurrent:owns})
    try{recovery.current.write(pending.key)}catch{return setNote('Browser recovery storage is unavailable. No Patient creation was requested.')}
    command.current=pending;flight.current=true;setBusy(true);setNote('')
    try{await finish(await pending.run())}finally{flight.current=false;if(owns())setBusy(false)}
  }
  const recover=async(readOnly=true)=>{if(flight.current||!owns()||!command.current)return;flight.current=true;setBusy(true);try{await finish(await command.current.run(readOnly))}finally{flight.current=false;if(owns())setBusy(false)}}
  const invite = async (e, d) => {
    e.preventDefault()
    if(flight.current||!owns())return
    flight.current=true;setBusy(true); setNote('')
    const r = await inviteToClaim(d.id, inviteEmail)
    flight.current=false
    if(!owns())return
    setBusy(false)
    if (!r.ok) return setNote((r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] : r.message) || 'Not sent.')
    setInviting(null); setInviteEmail('')
    // The email may be suppressed (a test address) or fail: say what the server reports, not "sent".
    const outcome = r.data?.status === 'transport_accepted' ? `A one-time link was emailed to ${inviteEmail}. It works once and expires.` : `${r.data?.message || 'The email was not sent.'} Check the email address and try again.`
    setNote(`${outcome} You keep managing ${d.first_name}’s record until they activate their own account.`)
  }
  if(loadError)return <ErrorState text={loadError} onRetry={reload}/>
  if(!rows)return <Skeleton lines={4} label="Loading Family records"/>
  return <section className="pp-card pp-fade" aria-labelledby="pp-family">
    <p className="pp-eyebrow" id="pp-family">Family</p>
    <p className="pp-hint">Children or others in your care. You can book, get reminders and pay for them. They need no ID or email; your ID is the one checked at the clinic.</p>
    {!capable&&<p role="status">Adding dependents is unavailable until this server supports safe creation and recovery. Saved Family records remain readable.</p>}
    {uncertain&&<div role="alert"><p>{note}</p><Button disabled={busy} onClick={()=>recover(true)}>{busy?'Recovering…':'Recover dependent creation'}</Button>{command.current?.intent&&<Button disabled={busy} onClick={()=>recover(false)}>Retry same creation</Button>}<Button variant="ghost" disabled={busy} onClick={reload}>Reload Family</Button></div>}
    {rows.length > 0 && <ul className="pp-family-list">{rows.map(d => <li key={d.id}><span><b>{d.name}</b> · {d.code} · {d.relationship}{d.relationship_other ? ` (${d.relationship_other})` : ''}{d.age !== null && d.age !== undefined ? ` · ${d.age} years old` : ''}</span>
      {!d.minor && !d.has_account && inviting !== d.id && <button type="button" className="link-button" onClick={() => { setInviting(d.id); setInviteEmail(''); setNote('') }}>Invite to their own account</button>}
      {inviting === d.id && <form className="pp-family-invite" onSubmit={e => invite(e, d)}>
        <Field label={`${d.first_name}’s own email`} hint="We email a one-time link there. Only they can then set the password."><input type="email" autoComplete="off" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}/></Field>
        <div className="pp-row-actions"><Button type="submit" size="sm" disabled={busy || !inviteEmail}>{busy ? 'Sending…' : 'Send the link'}</Button><button type="button" className="link-button" onClick={() => setInviting(null)}>Cancel</button></div>
      </form>}</li>)}</ul>}
    {adding ? <form onSubmit={add} className="pp-form"><fieldset disabled={busy||uncertain} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <Field label="First name" required><input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}/></Field>
      <Field label="Last name" required><input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}/></Field>
      <Field label="Date of birth" required><input type="date" value={form.date_of_birth} onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))}/></Field>
      <SelectWithOther label="Relationship" required value={form.relationship} onChange={v => setForm(f => ({ ...f, relationship: v }))} options={['Child', 'Daughter', 'Son', 'Grandchild', 'Ward', 'Parent', 'Other']} otherValue={form.relationship_other} onOtherChange={v => setForm(f => ({ ...f, relationship_other: v }))} placeholder="e.g., Niece, Nephew, Cousin"/>
      <label className="au-check"><input type="checkbox" checked={form.consent} onChange={e => setForm(f => ({ ...f, consent: e.target.checked }))}/> <span>I am their parent or guardian and agree that the clinic keeps their details for their dental care (<a href="#privacy" target="_blank" rel="noreferrer">Privacy Policy</a>).</span></label>
      <Button type="submit" size="lg" disabled={busy || !form.consent || (form.relationship === 'Other' && !(form.relationship_other || '').trim())}>{busy ? 'Saving…' : 'Add to my family'}</Button>
    </fieldset></form> : <Button size="lg" variant="soft" disabled={!capable||busy||uncertain} onClick={() => setAdding(true)}>Add a child or dependent</Button>}
    {note && !uncertain && <p className="pp-hint" role="status">{note}</p>}
  </section>
}

