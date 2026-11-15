import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {requestLeave,decideLeave,cancelLeave} from './api-client.js'
import {commandKey} from './appointments-api.js'
import {confirmedLeaveCommand,validLeaveRevision} from './leave-command.js'

const layout=typeof window==='undefined'?useEffect:useLayoutEffect
export function useLeaveCommand(getAuthGeneration) {
  const [phase,setPhase]=useState('idle'),[error,setError]=useState(''),[receipt,setReceipt]=useState(null)
  const live=useRef(false),pending=useRef(false),retained=useRef(null),blocked=useRef(false)
  layout(()=>{live.current=true;return()=>{live.current=false}},[])
  const run=async(action,id,revision,payload={})=>{
    if(!live.current||pending.current||blocked.current)return null
    if(!retained.current&&action!=='create'&&!validLeaveRevision(revision)){setError('Reload this leave request before changing it.');return null}
    const auth=getAuthGeneration?.(),owns=()=>live.current&&(!getAuthGeneration||(auth!=null&&auth===getAuthGeneration()))
    if(!owns())return null
    const command=retained.current||{action,id,body:{...payload,expected_revision:action==='create'?0:revision,operation_id:commandKey()}}
    retained.current=command;pending.current=true;setPhase('busy');setError('');setReceipt(null)
    const unknown=()=>{setPhase('uncertain');setError('The outcome is uncertain. Your original command is retained. Retry to recover its exact saved result.')}
    try {
      const r=command.action==='create'?await requestLeave(command.body,owns):command.action==='cancel'?await cancelLeave(command.id,command.body,owns):await decideLeave(command.id,command.action,command.body,owns)
      if(!owns())return null
      if(!r.ok){
        if(['network','server','csrf'].includes(r.kind))unknown()
        else {
          retained.current=null;blocked.current=['conflict','unauthenticated','forbidden','stale_context'].includes(r.kind)
          setPhase(r.kind==='conflict'?'conflict':blocked.current?'blocked':'idle')
          setError(Object.values(r.errors||{})[0]?.[0]||r.message||'This leave change was refused. Reload before trying again.')
        }
        return null
      }
      if(!confirmedLeaveCommand(command,r)){unknown();return null}
      retained.current=null;setPhase('idle');setReceipt(r.data);return r.data
    }catch{if(owns())unknown();return null}
    finally{pending.current=false}
  }
  const reviewed=()=>{if(pending.current||retained.current)return false;blocked.current=false;setPhase('idle');setError('');return true}
  return {run,reviewed,phase,error,receipt,locked:phase!=='idle',uncertain:phase==='uncertain',busy:phase==='busy'}
}
