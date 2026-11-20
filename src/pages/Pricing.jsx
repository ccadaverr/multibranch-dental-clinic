import React, { useEffect, useState } from 'react'
import { Button, Card, Field, Modal, Notice, PageHeader, Status, Table } from '../components.jsx'
import { clinicNow } from '../clock.js'
import { commandKey } from '../appointments-api.js'
import { listServices, setServiceOnlineBooking } from '../api-client.js'
import { createPriceVersion, formatAmount, inEffect, loadPriceVersions, retractPriceVersion, validAmount, versionStatus } from '../pricing-api.js'

// M13 pricing foundation — Owner "Services & Pricing". Confirmed prices are Owner-entered, effective-dated, append-only
// server versions and the only authoritative prices. The amount field always starts blank: no reference or demo fee exists in the server Service data.
const emptyForm = today => ({ level: 'base', kind: 'priced', amount: '', effectiveFrom: today })
const MARKET_RATES = {
  'Routine Dental Check-up': '₱800 - ₱1,200',
  'Consultation': '₱800 - ₱1,200',
  'Oral Prophylaxis (Cleaning)': '₱1,200 - ₱2,000',
  'Teeth Whitening': '₱8,000 - ₱15,000',
  'Tooth Extraction': '₱1,500 - ₱3,500',
  'Composite Restoration (Filling)': '₱1,500 - ₱2,500',
  'Root Canal Treatment': '₱8,000 - ₱15,000',
  'Ceramic Crown': '₱12,000 - ₱20,000',
  'Orthodontic Adjustment': '₱1,200 - ₱2,000',
  'Dentures': '₱15,000 - ₱35,000'
}

export function ServicesPricingPage({ store }) {
  const { state, toast } = store
  const today = clinicNow().date
  const [versions, setVersions] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [moreError, setMoreError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(() => emptyForm(today))
  const [confirming, setConfirming] = useState(null)
  const [retracting, setRetracting] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setError('')
    const result = await loadPriceVersions()
    if (result.ok) { setVersions(result.versions); setNextCursor(result.nextCursor); setMoreError('') }
    else setError(result.message || 'Could not load prices.')
  }
  const loadOlder = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true); setMoreError('')
    const result = await loadPriceVersions(nextCursor)
    setLoadingMore(false)
    if (!result.ok) return setMoreError(result.message || 'Older price versions could not be loaded.')
    setVersions(previous => [...previous, ...result.versions.filter(v => !previous.some(p => p.id === v.id))])
    setNextCursor(result.nextCursor)
  }
  // Until every version is loaded, "in effect today" / "superseded" cannot be stated truthfully.
  const complete = !nextCursor
  useEffect(() => { load() }, [])

  const selected = state.services.find(s => s.id === selectedId) || null
  const branchesOffering = selected ? state.branches.filter(b => state.branchServices.some(bs => bs.branchId === b.id && bs.serviceId === selected.id && bs.active !== false)) : []
  const open = service => { setSelectedId(service.id); setForm(emptyForm(today)) }
  const history = selected && versions ? versions.filter(v => v.serviceId === selected.id).sort((a, b) => (a.branchName || '').localeCompare(b.branchName || '') || a.effectiveFrom.localeCompare(b.effectiveFrom)) : []

  const levelLabel = level => (level === 'base' ? 'Base clinic price' : `${state.branches.find(b => b.id === level)?.name || level} price`)
  const review = () => {
    if (form.kind === 'priced' && !validAmount(form.amount)) return toast('Enter a price greater than zero with at most two decimals, for example 1500.00.', 'warning')
    if (!form.effectiveFrom || form.effectiveFrom < today) return toast('A price can start today or on a future date.', 'warning')
    setConfirming({ ...form, amount: String(form.amount).trim(), key: commandKey() })
  }
  const confirm = async () => {
    setBusy(true)
    const result = await createPriceVersion({ serviceId: selected.id, branchId: confirming.level === 'base' ? null : confirming.level, kind: confirming.kind, amount: confirming.amount, effectiveFrom: confirming.effectiveFrom }, confirming.key)
    setBusy(false)
    if (!result.ok) { toast(result.message, 'warning'); if (result.kind === 'conflict') { setConfirming(null); load() } return }
    setConfirming(null); setForm(emptyForm(today)); await load()
    toast(confirming.kind === 'priced' ? 'Confirmed price saved.' : 'Price ended at this level.', 'success')
  }
  const retract = async () => {
    setBusy(true)
    const result = await retractPriceVersion(retracting.version, retracting.key)
    setBusy(false)
    if (!result.ok) return toast(result.message, 'warning')
    setRetracting(null); await load(); toast('Scheduled price retracted.', 'success')
  }

  return <>
    <PageHeader title="Services & Pricing" text="Confirmed prices are entered by the Owner and take effect on a chosen date. Each change adds a new version; earlier versions are kept."/>
    <Notice tone="info" title="Confirmed prices">A <b>confirmed price</b> is one you enter and confirm here; billing will use only confirmed prices. A service with no confirmed price is reported as unavailable for billing.</Notice>
    {versions?.some(v => v.developmentSample) && <Notice>Development catalog prices are approved for demonstration billing. Treatment estimates still require clinical assessment and a separate quote.</Notice>}
    {error && <Notice tone="warning" title="Prices could not be loaded">{error} <Button size="sm" onClick={load}>Retry</Button></Notice>}
    {!versions && !error && <Notice>Loading prices…</Notice>}
    {versions && !complete && <Notice tone="warning" title="Only part of the price history is loaded">Older price versions exist. Current prices are shown only once the whole history is loaded. {moreError && <span role="alert">{moreError} </span>}<Button size="sm" variant="soft" disabled={loadingMore} onClick={loadOlder}>{moreError ? 'Retry' : loadingMore ? 'Loading…' : 'Load older price versions'}</Button></Notice>}
    {versions && <Card title="Services" subtitle="Base clinic price in effect today, with any branch prices">
      <Table rows={state.services} columns={[
        { key: 'name', label: 'Service', render: s => <div><b>{s.name}</b><small className="block-muted">{s.code} • {s.status}</small></div> },
        { key: 'market', label: 'Market reference price', render: s => <div><b>{MARKET_RATES[s.name] || '₱1,500 - ₱3,000'}</b><small className="block-muted">Philippine Dental Assoc. ref</small></div> },
        { key: 'base', label: 'Confirmed base price today', render: s => { if (!complete) return <small className="block-muted">Load the full history first</small>; const v = inEffect(versions, s.id, null, today); return v ? <span>{formatAmount(v.amount)} <small className="block-muted">since {v.effectiveFrom}</small></span> : <Status>No confirmed price</Status> } },
        { key: 'branches', label: 'Branch prices today', render: s => { if (!complete) return <small className="block-muted">Load the full history first</small>; const list = state.branches.map(b => [b, inEffect(versions, s.id, b.id, today)]).filter(([, v]) => v); return list.length ? list.map(([b, v]) => <small className="block-muted" key={b.id}>{b.name}: {v.kind === 'priced' ? formatAmount(v.amount) : 'ended (uses base)'}</small>) : '—' } },
        { key: 'actions', label: 'Actions', render: s => <Button size="sm" onClick={() => open(s)}>Manage prices</Button> },
      ]}/>
    </Card>}

    <OnlineBookingModes toast={toast}/>

    <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `${selected.name} — prices` : ''} subtitle="Versions are never edited. A scheduled (future) version can be retracted before it starts." wide>{selected && <>
      <h3>Price history</h3>
      {history.length ? <Table rows={history} columns={[
        { key: 'level', label: 'Level', render: v => (v.level === 'base' ? 'Base clinic price' : v.branchName) },
        { key: 'kind', label: 'Price', render: v => (v.kind === 'priced' ? formatAmount(v.amount) : 'Ended at this level') },
        { key: 'effectiveFrom', label: 'Effective from' },
        { key: 'status', label: 'Status', render: v => { const st = versionStatus(v, versions, today); return <Status>{!complete && (st === 'In effect' || st === 'Superseded') ? 'Load full history' : st}</Status> } },
        { key: 'by', label: 'Confirmed by', render: v => <small>{v.createdBy || '—'}{v.retractedAt ? ` • retracted by ${v.retractedBy || '—'}` : ''}</small> },
        { key: 'actions', label: 'Actions', render: v => (versionStatus(v, versions, today) === 'Scheduled' ? <Button size="sm" variant="ghost" onClick={() => setRetracting({ version: v, key: commandKey() })}>Retract</Button> : null) },
      ]}/> : <Notice>No confirmed price yet. Billing reports “pricing needed” for this service until you set one.</Notice>}
      <h3>Set a price</h3>
      <div className="form-grid">
        <Field label="Level"><select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })}><option value="base">Base clinic price (all branches)</option>{branchesOffering.map(b => <option key={b.id} value={b.id}>{b.name} only</option>)}</select></Field>
        <Field label="Action"><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, amount: '' })}><option value="priced">Set confirmed price</option><option value="ended">End price at this level</option></select></Field>
        {form.kind === 'priced' && <Field label="Confirmed price (₱)" required hint="Type the clinic’s price. The field is never pre-filled."><input inputMode="decimal" autoComplete="off" placeholder="e.g. 1500.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></Field>}
        <Field label="Effective from" required hint="Today or a future date"><input type="date" min={today} value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })}/></Field>
        <Button className="span-2" onClick={review}>Review price change</Button>
      </div>
    </>}</Modal>

    <Modal open={!!confirming} onClose={() => !busy && setConfirming(null)} title="Confirm authoritative price">{confirming && selected && <>
      <p><b>{selected.name}</b> • {levelLabel(confirming.level)}</p>
      <p>{confirming.kind === 'priced' ? <>Confirmed price: <b>{formatAmount(confirming.amount)}</b></> : <>End the price at this level{confirming.level === 'base' ? ' (the service will have no base price)' : ' (this branch will use the base price)'}</>} from <b>{confirming.effectiveFrom}</b>.</p>
      <Notice tone="warning">Billing will use this price from that date. Once it takes effect it cannot be changed — you can only add a newer version.</Notice>
      <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>Go back</Button><Button disabled={busy} onClick={confirm}>Confirm price</Button></div>
    </>}</Modal>

    <Modal open={!!retracting} onClose={() => !busy && setRetracting(null)} title="Retract scheduled price">{retracting && <>
      <p>Retract the {retracting.version.kind === 'priced' ? formatAmount(retracting.version.amount) : 'ended'} version for {retracting.version.level === 'base' ? 'the base clinic price' : retracting.version.branchName}, scheduled from {retracting.version.effectiveFrom}?</p>
      <p className="pt-hint">The version is kept in the history, marked retracted.</p>
      <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={() => setRetracting(null)}>Keep it</Button><Button disabled={busy} onClick={retract}>Retract</Button></div>
    </>}</Modal>
  </>
}

/**
 * F7 (R2-17): how each service is offered in online booking. "Consultation first" (for example Braces) shows "Starts with a
 * consultation" and books the chosen consultation instead; "Not shown online" leaves it to the front desk. Audited.
 */
function OnlineBookingModes({ toast }) {
  const [services, setServices] = useState(null), [busy, setBusy] = useState('')
  const load = () => listServices().then(r => { if (r.ok) setServices(r.data || []) })
  useEffect(() => { load() }, [])
  if (!services) return null
  const bookable = services.filter(s => s.status === 'Active' && s.online_booking === 'bookable')
  const change = async (service, mode, consultation) => {
    if (mode === 'consultation_first' && !consultation) consultation = bookable.find(s => s.id !== service.id && /consult/i.test(s.name))?.id || bookable.find(s => s.id !== service.id)?.id
    setBusy(service.id)
    const r = await setServiceOnlineBooking(service.id, { online_booking: mode, consultation_ref: mode === 'consultation_first' ? consultation : null })
    setBusy('')
    if (!r.ok) return toast((r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] : r.message) || 'Not saved.', 'warning')
    toast(`${service.name}: saved.`, 'success'); load()
  }
  return <Card title="Online booking" subtitle="Interview R2-17: braces and other sensitive services start with a consultation, and the patient pays for that consultation.">
    <Table rows={services.filter(s => s.status === 'Active')} columns={[
      { key: 'name', label: 'Service', render: s => <b>{s.name}</b> },
      { key: 'mode', label: 'In online booking', render: s => <select aria-label={`Online booking for ${s.name}`} value={s.online_booking} disabled={busy === s.id} onChange={e => change(s, e.target.value)}>
        <option value="bookable">Patients book it directly</option><option value="consultation_first">Starts with a consultation</option><option value="hidden">Not shown online</option>
      </select> },
      { key: 'consult', label: 'Consultation booked instead', render: s => s.online_booking === 'consultation_first'
        ? <select aria-label={`Consultation for ${s.name}`} value={s.consultation_service_id || ''} disabled={busy === s.id} onChange={e => change(s, 'consultation_first', e.target.value)}>
          {bookable.filter(c => c.id !== s.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : <small className="block-muted">—</small> },
    ]}/>
  </Card>
}
