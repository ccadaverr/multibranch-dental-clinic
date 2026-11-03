import React from 'react'
import {createRoot} from 'react-dom/client'
import {DentalChartPage, ChartView} from '../../src/pages/DentalChart.jsx'
import {TeethPage} from '../../src/patient/pages/Teeth.jsx'
import {clinicalFixture} from '../support/den-ui-02-fixture.js'
import '../../src/styles.css'
import '../../src/foundation.css'
import '../../src/polish.css'
import '../../src/automations.css'
import '../../src/patient/portal.css'
const clinical=clinicalFixture()
clinical.session.branchId=1
clinical.state.users[0].branchId=1
clinical.state.dentists[0].branchIds=[1,2]
clinical.state.branches=[{id:1,name:'Synthetic Central',status:'Open'},{id:2,name:'Synthetic North',status:'Open'}]
window.clin03Toasts=[]
const store={...clinical,toast:(...args)=>window.clin03Toasts.push(args)}
const role=new URLSearchParams(location.search).get('role')||'dentist'
createRoot(document.getElementById('root')).render(<main style={{padding:16}}><p>Synthetic chart data ? intercepted APIs ? no real records</p>{role==='patient'?<TeethPage/>:role==='staff'?<ChartView patientId="pA" canRecord={false} store={store} toast={store.toast}/>:<DentalChartPage store={store} setPage={()=>{}}/>}</main>)
