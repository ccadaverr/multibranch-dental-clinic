import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {BookPage} from '../../src/patient/pages/Book.jsx'
import {BookingCalendar} from '../../src/patient/BookingCalendar.jsx'
import {Button,Field,FilterBar,Modal,SelectWithOther} from '../../src/components.jsx'
import {PrescriptionsServerPage} from '../../src/pages/ServerPrescriptions.jsx'
import {clinicalFixture} from '../support/den-ui-02-fixture.js'
import {CheckInPage} from '../../src/pages/PatientFlow.jsx'
import {clinicDate} from '../../src/clock.js'
import '../../src/styles.css'
import '../../src/foundation.css'
import '../../src/polish.css'
import '../../src/patient/portal.css'
import '../../src/automations.css'
function StaffFixture(){
 const base=clinicalFixture(),[arrived,setArrived]=useState(false),[message,setMessage]=useState('')
 base.session={...base.session,role:'staff'};base.state.users[0].roleName='Staff';base.state.staff=[{userId:base.session.userId,personId:base.state.users[0].personId,branchId:'b1'}]
 base.state.appointments=arrived?[]:[{id:'synthetic-appt',patientId:'p1',branchId:'b1',dentistId:'d1',date:clinicDate(),start:'09:00',service:'Synthetic consultation',status:'Confirmed'}];base.state.visits=[]
 const store={...base,appointmentsStatus:'ready',toast:m=>setMessage(m),directoryPatients:[{id:'p1',name:'Synthetic patient Alexandra',patientCode:'QA-001'},{id:'p2',name:'Synthetic patient Beatriz with a long family name',patientCode:'QA-002'}],appointmentFlow:{searchPatients(){},refresh(){},async checkIn(id){window.qaStaffCalls=(window.qaStaffCalls||[]).concat(id);setArrived(true);return {ok:true,queued:true,queueNumber:1}}}}
 return <><p role="status">{message}</p><CheckInPage store={store} setPage={()=>{}}/></>
}
function Fixture(){
 const [mode,setMode]=useState('book'),[role,setRole]=useState('Patient'),[branch,setBranch]=useState('b1'),[value,setValue]=useState('Standard'),[other,setOther]=useState(''),[open,setOpen]=useState(false),[disabled,setDisabled]=useState(false)
 window.qa02={setMode,setRole,setBranch,setDisabled}
 window.qa02Toasts ||= []
 const clinical=clinicalFixture()
 if(mode==='staff')return <main style={{padding:16}}><StaffFixture/></main>
 const controls=<><SelectWithOther label="ID type" value={value} onChange={setValue} otherValue={other} onOtherChange={setOther} options={['Standard','Other']} placeholder="Company card"/><Field label="Branch"><select disabled={disabled} value={branch} onChange={e=>setBranch(e.target.value)}><option value="b1">Illustrative Central Branch</option><option value="b2">Illustrative Branch with a long descriptive name for responsive testing</option></select></Field></>
 return <div className="pp-shell"><div className="pp-body"><main className="pp-main"><p>Synthetic {role} QA · all API calls intercepted</p>{mode==='book'?<BookPage prefill={{service:'consult'}} toast={()=>{}} onNavigate={()=>{}}/>:mode==='rx'?<PrescriptionsServerPage role="dentist" store={{...clinical,toast:(...args)=>window.qa02Toasts.push(args)}}/>:mode==='calendar'?<BookingCalendar branchId={branch} serviceId="consult" value="" onChange={()=>{}}/>:<><h1>{role} controls</h1><FilterBar filters={[{label:'Status',value:'all',options:[{value:'all',label:'All statuses'}],onChange(){}}]}/>{controls}<Button onClick={()=>setOpen(true)}>Open form</Button><Modal open={open} title="Synthetic form" onClose={()=>setOpen(false)}><div style={{maxHeight:240,overflowY:'auto'}}>{controls}<Button onClick={()=>setOpen(false)}>Done</Button></div></Modal></>}</main></div></div>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
