import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../../components.jsx'
import { downloadPrescriptionPdf, myPrescriptions } from '../../api-client.js'
import { useVisibleRefresh } from '../../use-visible-refresh.js'
import { EmptyState, ErrorState, PageHead, Skeleton } from '../ui.jsx'

const day = iso => iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : ''

/** M19: the patient's (and their dependents') issued prescriptions, read-only, with the PDF. A void one is marked VOID. */
export function PrescriptionsPage({ toast = () => {} }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const live = useRef(false), serial = useRef(0), pending = useRef(false)
  const load = async () => {
    if (pending.current) return
    pending.current = true
    const ticket = ++serial.current
    setError('')
    try {
      const r = await myPrescriptions()
      if (!live.current || ticket !== serial.current) return
      if (!r.ok || !Array.isArray(r.data) || r.data.some(p => !p?.id || !p.patient?.id || !p.visit || !['Issued','Void'].includes(p.status) || !p.number || !p.issued_at || !Array.isArray(p.lines))) {
        setRows(null); setError(r.message || 'Your prescriptions could not be verified. Try again.'); return
      }
      setRows(r.data)
    } catch { if (live.current && ticket === serial.current) { setRows(null); setError('Your prescriptions could not be loaded. Try again.') } }
    finally { if (ticket === serial.current) pending.current = false }
  }
  useEffect(() => { live.current = true; pending.current = false; load(); return () => { live.current = false; serial.current++; pending.current = false } }, [attempt])
  useVisibleRefresh(load)
  return <div className="pp-page pp-fade">
    <PageHead eyebrow="Records & Billing" title="Prescriptions" text="Prescriptions your dentist issued after a visit. Follow your dentist’s instructions; call the branch if you have a question."/>
    {error && <ErrorState text={error} onRetry={() => setAttempt(a => a + 1)}/>}
    {!rows && !error && <Skeleton lines={4} label="Loading your prescriptions"/>}
    {rows && !rows.length && <EmptyState icon="file" title="No prescriptions yet" text="Prescriptions issued by your dentist after a visit will appear here."/>}
    {rows && rows.length > 0 && <section className="pp-card">
      <ul className="pp-rx-list">{rows.map(p => <li key={p.id} className={p.status === 'Void' ? 'is-void' : ''}>
        <p><b>{p.number}</b> · {day(p.issued_at)}{p.patient?.name ? ` · ${p.patient.name}` : ''}{p.status === 'Void' ? <span className="pp-void"> VOID — do not use</span> : ''}</p>
        <p className="pp-hint">{p.dentist} · {p.branch}</p>
        <ol>{(p.lines || []).map((l, i) => <li key={i}><b>{l.medicine}</b>{[l.dosage, l.frequency, l.duration].filter(Boolean).length ? ` — ${[l.dosage, l.frequency, l.duration].filter(Boolean).join(', ')}` : ''}{l.instructions ? `. ${l.instructions}` : ''}</li>)}</ol>
        {p.note && <p className="pp-hint">Note: {p.note}</p>}
        {p.voided && <p className="pp-hint">Voided: {day(p.voided.at)}. Reason: {p.voided.reason}</p>}
        <Button size="sm" variant="soft" icon="download" onClick={async () => { const r = await downloadPrescriptionPdf(p.id, p.number); if (!r.ok) toast(r.message || 'The PDF could not be downloaded.', 'warning') }}>Download PDF</Button>
      </li>)}</ul>
    </section>}
  </div>
}
