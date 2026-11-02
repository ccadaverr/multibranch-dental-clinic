import React, {useRef,useState,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {Shell} from '/src/layout.jsx'
import {QueuePage} from '/src/pages/PatientFlow.jsx'
import {TreatmentPage,PatientsPage} from '/src/pages/Clinical.jsx'
import {DentalChartPage} from '/src/pages/DentalChart.jsx'
import {PrescriptionsServerPage} from '/src/pages/ServerPrescriptions.jsx'
import {FollowupsServerPage} from '/src/pages/ServerFollowups.jsx'
import {ClinicalNavigation,useClinicalNavigation} from '/src/clinical-navigation.jsx'
import {clinicalSessionKey} from '/src/encounter.js'
import {createAppointmentFlow} from '/src/appointment-flow.js'
import {loadQueue,mapQueueEntry} from '/src/queue-api.js'
import {loadVisits,mapVisit} from '/src/visits-api.js'
import {loadTreatments,mapTreatment} from '/src/treatments-api.js'
import {setClockSource} from '/src/clock.js'
import {reportSessionInvalidated} from '/src/api-client.js'
import {clinicalFixture,today} from '../support/den-ui-02-fixture.js'
import '/src/styles.css'
import '/src/foundation.css'
import '/src/patient.css'
import '/src/polish.css'
import '/src/automations.css'
setClockSource(()=>new Date(today+'T10:00:00+08:00'))
function Fixture(){
  const initial=useRef(clinicalFixture())
  const [state,setState]=useState(initial.current.state),[session,setSession]=useState(initial.current.session)
  const [status,setStatus]=useState('loading'),[page,setPage]=useState('queue'),[context,setContext]=useState(null)
  const latest=useRef(state),actor=useRef(session);latest.current=state;actor.current=session
  const nav=useClinicalNavigation(clinicalSessionKey(session))
  const refresh=async()=>{
    const [q,v,t]=await Promise.all([loadQueue(today),loadVisits(today),loadTreatments(today)])
    if(!q.ok||!v.ok||!t.ok){setStatus('error');return {ok:false}}
    const next={...latest.current,queue:q.rows.map(x=>mapQueueEntry(x)),visits:v.rows.map(x=>mapVisit(x)),treatments:t.rows.map(x=>mapTreatment(x))}
    latest.current=next;setState(next);setStatus('ready');return {ok:true}
  }
  const flow=useRef(null)
  if(!flow.current)flow.current=createAppointmentFlow({getState:()=>latest.current,getSession:()=>actor.current,getActions:()=>({reconcileTreatmentHandoffs:()=>({ok:true,warnings:[]})}),refresh})
  useEffect(()=>{refresh()},[])
  const go=(p,c=null)=>nav.request(()=>{setContext(c);setPage(p)})
  window.encFixture={go,refresh,expire:()=>reportSessionInvalidated(),sessionChange:()=>setSession(null),setStatus,changeState:patch=>{const n={...latest.current,...patch};latest.current=n;setState(n)},getContext:()=>context}
  const store={state,session,appointmentsStatus:status,appointmentsTruncated:false,queueSnapshot:{date:today,truncated:false},appointmentFlow:flow.current,toast(){},actions:{},log(){}}
  const props={role:'dentist',store,context,setPage:go,activeBranch:'Illustrative Central Branch'}
  const pages={queue:<QueuePage {...props}/>,treatment:<TreatmentPage {...props}/>,patients:<PatientsPage {...props}/>,chart:<DentalChartPage {...props}/>,prescriptions:<PrescriptionsServerPage {...props}/>,followups:<FollowupsServerPage {...props}/>}
  return <ClinicalNavigation.Provider value={nav.register}><Shell role="dentist" store={store} page={page} setPage={go} activeBranch="Illustrative Central Branch" setActiveBranch={()=>{}} onLogout={()=>nav.request(()=>setSession(null))}>
    <p style={{fontSize:12,color:'#526674'}}>Illustrative test data · intercepted APIs · no live clinical records</p>
    {pages[page]||<button onClick={()=>go('queue')}>Return to My Queue</button>}
  </Shell>{nav.dialog}</ClinicalNavigation.Provider>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
