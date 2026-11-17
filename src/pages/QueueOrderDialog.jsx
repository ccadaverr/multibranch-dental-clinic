import React, {useEffect, useRef, useState} from 'react'
import {Button, Field, Modal, Notice} from '../components.jsx'
import {commandKey} from '../appointments-api.js'
import {checkInActorKey} from '../checkin-navigation.js'

export function QueueOrderDialog({entry, store, onClose}) {
  const flow = store.appointmentFlow
  const actor = checkInActorKey(store.session), generation = store.getAuthGeneration?.()
  const origin = useRef({actor, generation})
  const latest = useRef({actor, generation})
  latest.current = {actor, generation}
  const live = useRef(true), sending = useRef(false), attempt = useRef(null)
  const current = () => live.current && latest.current.actor === origin.current.actor && latest.current.generation === origin.current.generation
  const [snapshot, setSnapshot] = useState(null), [before, setBefore] = useState(''), [reason, setReason] = useState('')
  const [phase, setPhase] = useState('loading'), [message, setMessage] = useState('')
  const feedback = useRef(null)
  const load = async () => {
    if (sending.current || !current()) return
    attempt.current = null; setSnapshot(null); setPhase('loading'); setMessage('')
    try {
      const result = await flow.queueOrderSnapshot(entry)
      if (!current()) return
      if (!result.ok) {setPhase('load-error'); setMessage(result.message || 'The current queue could not be loaded.'); return}
      setSnapshot(result.snapshot); setBefore(''); setPhase('ready')
    } catch {if(current()){setPhase('load-error');setMessage('The current queue could not be loaded. Try again.')}}
  }
  useEffect(() => {live.current=true; load(); return () => {live.current=false}}, [])
  useEffect(() => {if(['refused','unknown','saved','load-error'].includes(phase)) feedback.current?.focus()}, [phase])
  if (!current()) return null
  const target = snapshot?.entries.find(row => row.id === entry.id)
  const waiting = row => ['In Queue','Waiting'].includes(row.status)
  const locked = ['saving','unknown'].includes(phase)
  const send = async event => {
    event?.preventDefault()
    if (sending.current || !current()) return
    if (!attempt.current) {
      if (!target || !waiting(target) || reason.trim().length < 3) return
      attempt.current = {entry:{...entry,revision:target.revision}, key:commandKey(), payload:{
        expected_revision:target.revision, order_revision:snapshot.revision, before_entry_id:before || null, reason:reason.trim(),
      }}
    }
    sending.current=true; setPhase('saving'); setMessage('')
    const command=attempt.current
    try {
      const result=await flow.queueReorder(command.entry,command.payload,command.key,current)
      if (!current()) return
      if (!result.ok) {
        setPhase(result.uncertain || result.kind === 'network' ? 'unknown' : 'refused')
        setMessage(result.message || 'This move was not confirmed. Review the current queue before trying again.')
        return
      }
      setPhase('saved'); setMessage(`Move recorded: branch position ${result.receipt?.from_position ?? '—'} to ${result.receipt?.to_position ?? '—'}. ${result.warning || 'Arrival time is unchanged. The live queue may change as Patients are called.'}`)
    } catch {if(current()){setPhase('unknown');setMessage('The move is unconfirmed. Retry the same move to retrieve its receipt.')}}
    finally {sending.current=false}
  }
  return <Modal open title="Move waiting Patient" subtitle={`${entry.patientName} · ${entry.branch || entry.branchId}`} onClose={() => {if(!locked)onClose()}}>
    <p>Arrival order is the default. A Staff move needs a reason and is recorded in history. Patients already called cannot be displaced.</p>
    <div ref={feedback} tabIndex={-1} role={['unknown','refused','load-error'].includes(phase)?'alert':'status'}>{message&&<Notice tone={phase==='saved'?'success':'warning'}>{message}</Notice>}</div>
    {phase==='loading'&&<p role="status">Loading current branch order…</p>}
    {phase==='load-error'&&<Button onClick={load}>Retry loading queue</Button>}
    {snapshot&&phase!=='saved'&&<form onSubmit={send}>
      {!target||!waiting(target)?<Notice tone="warning">This Patient is no longer waiting. Close and review the live queue.</Notice>:<>
        <Field label="Move before" hint="Choose a waiting Patient, or the end of this branch queue.">
          <select aria-label="Move before" value={before} disabled={locked||phase==='refused'} onChange={e=>setBefore(e.target.value)}>
            <option value="">End of branch queue</option>
            {snapshot.entries.filter(row=>row.id!==entry.id&&waiting(row)).map(row=><option key={row.id} value={row.id}>#{row.branch_position} · {row.patient.name} · {row.dentist.name}</option>)}
          </select>
        </Field>
        <Field label="Reason for move" required hint="Use an operational reason. Do not include medical details or ID numbers.">
          <textarea aria-label="Reason for move" value={reason} required minLength={3} maxLength={300} disabled={locked||phase==='refused'} onChange={e=>setReason(e.target.value)}/>
        </Field>
        <div className="row-actions top-gap">
          {phase==='unknown'?<Button type="submit">Retry same move</Button>:phase==='refused'?<Button onClick={load}>Reload current order</Button>:<Button type="submit" disabled={locked||reason.trim().length<3}>{phase==='saving'?'Recording move…':'Record move'}</Button>}
          <Button variant="ghost" disabled={locked} onClick={onClose}>Cancel</Button>
        </div>
      </>}
    </form>}
    {phase==='saved'&&<Button onClick={onClose}>Return to live queue</Button>}
  </Modal>
}
