import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Odontogram} from '../../src/components/odontogram/index.js'
import '../../src/styles.css'
import '../../src/foundation.css'
import '../../src/polish.css'
import '../../src/automations.css'
import '../../src/patient/portal.css'

const params = new URLSearchParams(location.search)
const data = {
  settings: {numbering: params.get('numbering') || 'fdi', statuses: ['Healthy', 'Caries', 'Filled']},
  current: [{id: 'a', tooth: '18', status: 'Caries', surfaces: ['M']}, {id: 'b', tooth: '55', status: 'Filled', surfaces: ['D']}],
  history: [],
}
window.clin04Selections = []
window.clin04Records = []
function Fixture() {
  const [selected, select] = useState(null)
  return <main style={{padding: 16}}>
    <h1>Synthetic patient A — dental chart</h1>
    <button type="button">Before chart</button>
    <Odontogram data={data} selected={selected} onSelect={tooth => {window.clin04Selections.push(tooth); select(tooth)}}
      canRecord={!['staff', 'patient'].includes(params.get('role'))}
      onRecord={async body => {window.clin04Records.push(body); return {ok: true}}}
      branches={[{id: 1, name: 'Synthetic Central'}]} activeBranchId={1}/>
    <button type="button">After chart</button>
  </main>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
