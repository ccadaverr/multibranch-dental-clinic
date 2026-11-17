import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, ConfirmDialog, Field, PageHeader, RefreshButton, SearchInput } from '../../src/components.jsx'
import '../../src/styles.css'
import '../../src/foundation.css'
import '../../src/patient.css'
import '../../src/public-site.css'
import '../../src/polish.css'
import '../../src/patient/portal.css'
import '../../src/landing.css'
import '../../src/automations.css'

function Controls() {
  const [count, setCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [query, setQuery] = useState('Synthetic appointment')
  return <main className="content">
    <PageHeader title="Button controls" aside={<Button size="sm" data-sample onClick={() => setCount(n => n + 1)}>Review all appointments for the selected branch</Button>}/>
    <div className="row-actions">
      <Button data-sample size="sm" variant="ghost" onClick={() => setCount(n => n + 1)}>Compact action</Button>
      <Button data-sample variant="soft">Review available appointments</Button>
      <Button data-sample size="lg">Continue to the next step</Button>
      <Button data-sample variant="danger" onClick={() => setConfirm(true)}>Review cancellation</Button>
      <Button data-sample disabled onClick={() => setCount(n => n + 100)}>Unavailable action</Button>
      <RefreshButton data-sample ariaLabel="Refresh appointments" size="sm" loading={refreshing} onClick={() => setRefreshing(true)}/>
    </div>
    <Field label="Branch" error="Choose a currently available branch before proceeding with this request.">
      <select><option>Synthetic branch</option></select>
    </Field>
    <SearchInput value={query} onChange={setQuery} onClear={() => setQuery('')} ariaLabel="Search appointments"/>
    <output aria-label="Activation count">{count}</output>
    <ConfirmDialog open={confirm} title="Confirm cancellation?" cancelLabel="Keep appointment" confirmLabel="Cancel appointment"
      onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); setCount(n => n + 1) }}>
      <p>Review the selected appointment before confirming this irreversible action.</p>
    </ConfirmDialog>
  </main>
}
createRoot(document.getElementById('root')).render(<Controls/>)
