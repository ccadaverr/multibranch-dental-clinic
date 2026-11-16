import React from 'react'
import {createRoot} from 'react-dom/client'
import {ToothTimeline} from '../../src/components/odontogram/ToothTimeline.jsx'
import '../../src/styles.css'
import '../../src/foundation.css'
import '../../src/polish.css'
import '../../src/components/odontogram/odontogram.css'

const pending=[]
window.chartRecovery={calls:[],dirty:[],reject(){pending.shift().reject(Error('Synthetic response lost'))},confirm(){pending.shift().resolve({ok:true,revision:8})}}
createRoot(document.getElementById('root')).render(<main style={{maxWidth:600,margin:'auto',padding:16}}>
  <h1>Synthetic chart editor recovery</h1>
  <ToothTimeline tooth="16" canRecord branches={[{id:'b1',name:'Synthetic Central'},{id:'b2',name:'Synthetic North'}]} activeBranchId="b1"
    data={{settings:{statuses:['Caries','Filled']},current:[],history:[],tooth_revisions:{16:7}}}
    onDirtyChange={value=>window.chartRecovery.dirty.push(value)}
    onRecord={payload=>{window.chartRecovery.calls.push(structuredClone(payload));return new Promise((resolve,reject)=>pending.push({resolve,reject}))}}/>
</main>)
