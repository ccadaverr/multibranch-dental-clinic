import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { PatientPortal } from '/src/patient/Portal.jsx'
import '/src/styles.css'
import '/src/foundation.css'
import '/src/patient.css'
import '/src/polish.css'
import '/src/patient/portal.css'

const fixture=window.moreFixture={writes:[],logout:0}
window.fetch=async(url,options={})=>{
  const path=new URL(url,location.href).pathname
  if(options.method&&options.method!=='GET'){fixture.writes.push(path);return Response.json({message:'Synthetic mutation refused'},{status:403})}
  return Response.json({data:[],meta:{unread:0}})
}
const me={id:'synthetic-account',name:'Synthetic Patient',email:'synthetic@example.invalid',role:'patient',account_status:'Active',patient:{id:'synthetic-patient'}}
const store={session:{serverUserId:me.id,role:'patient',active:true},toast(){}}
function Fixture(){
  const[mounted,setMounted]=useState(true)
  fixture.mount=value=>flushSync(()=>setMounted(value))
  return <><button id="outside-control" type="button">Synthetic background control</button>{mounted?<PatientPortal me={me} store={store} initialPage="security" onLogout={()=>{fixture.logout++}} onSignedOut={()=>{}}/>:<p>Portal unmounted</p>}</>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>)
