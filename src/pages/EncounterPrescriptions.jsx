import React, {useEffect, useRef, useState} from 'react'
import {Button, Notice, Status} from '../components.jsx'
import {listPrescriptions} from '../api-client.js'
import {clinicalSessionKey} from '../encounter.js'
import {readEncounterPrescriptions} from '../prescription-readback.js'
import {PrescriptionDialog} from './ServerPrescriptions.jsx'

/** Read existing prescriptions directly from an exact completed encounter; never author or issue here. */
export function EncounterPrescriptions({store, patientId, visitId, branchId}) {
  return <EncounterPrescriptionList key={JSON.stringify([clinicalSessionKey(store.session),store.getAuthGeneration?.(),patientId,visitId,branchId])}
    store={store} expected={{patientId,visitId,branchId}}/>
}

function EncounterPrescriptionList({store, expected}) {
  const [rows,setRows]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[picked,setPicked]=useState(null)
  const live=useRef(false),latest=useRef(store);latest.current=store
  const actor=clinicalSessionKey(store.session),generation=store.getAuthGeneration?.()
  const owns=()=>live.current&&clinicalSessionKey(latest.current.session)===actor&&latest.current.getAuthGeneration?.()===generation
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  useEffect(()=>{
    let current=true;setRows(null);setError('')
    readEncounterPrescriptions(listPrescriptions,expected).then(r=>{
      if(!current||!owns())return
      if(!r?.ok)return setError(r?.message||'Prescriptions could not be checked. Retry to read saved records.')
      setRows(r.data)
    })
    return()=>{current=false}
  },[attempt])
  return <section aria-label="Encounter prescriptions">
    <h3>Prescriptions for this Visit</h3>
    <p className="muted-copy">Saved records only. A Draft is unissued; VOID records remain part of the history. Review does not change them.</p>
    {error?<Notice tone="warning">{error}<Button onClick={()=>setAttempt(a=>a+1)}>Retry encounter prescriptions</Button></Notice>
      :rows===null?<p role="status">Loading encounter prescriptions…</p>
      :!rows.length?<p>No authorized prescriptions were returned for this exact Visit.</p>
      :<ul>{rows.map(p=><li key={p.id}><Status>{p.status==='Void'?'VOID':p.status}</Status> {p.number||'Unissued draft'}{' '}
        <Button variant="soft" onClick={()=>setPicked(p.id)}>Review {p.number||'draft prescription'}</Button></li>)}</ul>}
    {picked&&<PrescriptionDialog id={picked} expectedContext={expected} viewOnly getAuthGeneration={store.getAuthGeneration}
      clinicalContext={store.session?.clinicalContext} toast={store.toast} onClose={()=>setPicked(null)}/>}
  </section>
}
