import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AddDentist} from '../../src/pages/ServerMessages.jsx'
import '../../src/styles.css'
import '../../src/foundation.css'
import '../../src/polish.css'
function Fixture(){const [accepted,setAccepted]=useState(0);return <main style={{padding:16,maxWidth:600,margin:'auto'}}>
  <h1>Synthetic conversation</h1><p>Patient Synthetic One · Branch Synthetic Central</p>
  <AddDentist conversationId="01ARZ3NDEKTSV4RRFFQ69G5FAV" context={{patientId:'01ARZ3NDEKTSV4RRFFQ69G5FAY',branchId:'b1'}} onAdded={()=>setAccepted(n=>n+1)} toast={()=>{}}/>
  <p role="status">Confirmed changes: {accepted}</p>
</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
