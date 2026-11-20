import React, { useEffect, useRef, useState } from 'react'
import { Button, FilterBar, Modal } from '../../components.jsx'
import { downloadAppointmentReceiptPdf, downloadBillingPdf, listAppointments, myBillingInvoices, myDependents, myTreatments } from '../../api-client.js'
import { boundedClinicalRead } from '../../clinical-history.js'
import { confirmedBillingReceipt } from '../../billing-command.js'
import { paymentMethodLabel } from '../../payment-method.js'
import { loadInvoiceHistory, readOwnedArchive } from '../archive-readback.js'
import { dateLong, money, splitAppointments, time12 } from '../format.js'
import { invoiceMatches } from '../invoice-readback.js'
import { loadPatientAppointments, loadTreatmentHistory, treatmentSummaries } from '../visit-history.js'
import { EmptyState, ErrorState, LoadingState, PageHead, Pill, useLoad } from '../ui.jsx'
import { AppointmentDetails } from './Visits.jsx'

const VISIT_STATUSES = ['Completed', 'Cancelled', 'No-show', 'Confirmed', 'Pending']
const PAGE_SIZE = 12

function receiptDate(iso) {
  if (!Number.isFinite(Date.parse(iso))) return ''
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(iso))
}

export function ArchivesPage({ toast, session, getAuthGeneration, onNavigate, filters, setFilters }) {
  const { tab, status, search, page } = filters
  const update = fields => setFilters(previous => ({ ...previous, page: 1, ...fields }))
  const [detail, setDetail] = useState(null)
  const [downloading, setDownloading] = useState('')
  const downloadPending = useRef(false)
  const live = useRef(false)
  const generation = getAuthGeneration?.()
  const patientId = session?.patientPublicId
  const owns = () => live.current && session?.active === true && session.role === 'patient' && !!patientId &&
    (!getAuthGeneration || generation != null && getAuthGeneration() === generation)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const appointments = useLoad(signal => readOwnedArchive(async guard => {
    const people = await myDependents()
    if (!people.ok) return people
    if (!Array.isArray(people.data) || people.meta?.me?.id !== patientId || people.data.some(person => !person?.id)) {
      return { ok: false, kind: 'stale_context', message: 'The authorized patient history could not be verified.' }
    }
    const allowed = [patientId, ...people.data.map(person => person.id)]
    const result = await loadPatientAppointments(guard(params => listAppointments(params, signal)))
    if (!result.ok) return result
    if (result.data.some(row => !allowed.includes(row.patient?.id))) {
      return { ok: false, kind: 'stale_context', message: 'The returned appointments did not identify an authorized patient.' }
    }
    return { ...result, data: { rows: result.data, allowed } }
  }, () => owns() && !signal.aborted), [patientId, generation])

  const treatments = useLoad(signal => readOwnedArchive(async guard => {
    const result = await loadTreatmentHistory(guard(myTreatments))
    if (!result.ok) return result
    const rows = result.data
    if (new Set(rows.map(row => row?.id)).size !== rows.length || rows.some(row =>
      typeof row?.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      typeof row.procedure_summary !== 'string' || !Array.isArray(row.services) ||
      row.services.some(service => typeof service?.name !== 'string') || typeof row.dentist?.name !== 'string')) {
      return { ok: false, kind: 'stale_context', message: 'Treatment summaries could not be verified.' }
    }
    return result
  }, () => owns() && !signal.aborted), [patientId, generation])

  const invoices = useLoad(signal => tab === 'receipts'
    ? readOwnedArchive(guard => loadInvoiceHistory(guard(myBillingInvoices)), () => owns() && !signal.aborted)
    : { ok: true, data: null }, [tab, patientId, generation])

  const visits = [...splitAppointments(appointments.data?.rows).past,
    ...treatmentSummaries(treatments.data)].sort((a, b) =>
    String(b.starts_at || b.date).localeCompare(String(a.starts_at || a.date)) || a.id.localeCompare(b.id))
  const loadedReceipts = !!(invoices.data && appointments.data)
  const verifiedReceipts = loadedReceipts && invoices.data.every(invoice => invoiceMatches(invoice, appointments.data.allowed))
  const receipts = verifiedReceipts ? [
    ...invoices.data.filter(confirmedBillingReceipt),
    ...appointments.data.rows.filter(row => row.booking_payment_status === 'paid' && Number(row.booking_fee_php) > 0).map(row => ({
      id: `booking-${row.id}`, appointmentId: row.id, appointmentCode: row.code, patient: row.patient,
      isBookingDeposit: true, invoice_number: row.code, branch: row.branch,
      receipt: { number: row.code, amount: Number(row.booking_fee_php), method: row.booking_payment_method, issued_at: row.booking_paid_at || row.date },
    })),
  ].sort((a, b) => String(b.receipt.issued_at).localeCompare(String(a.receipt.issued_at))) : []

  const matches = parts => parts.filter(Boolean).join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  const filtered = tab === 'visits' ? visits.filter(row => (status === 'all' || row.status === status) && matches([
    row.service?.name, row.branch?.name, row.patient?.name, row.patient?.code, row.dentist?.name,
    row.code, row.status, row.date, dateLong(row.date), time12(row.start_time),
  ])) : receipts.filter(row => matches([
    row.invoice_number, row.receipt.number, row.branch?.name, row.patient?.name, row.patient?.code,
    receiptDate(row.receipt.issued_at), row.receipt.issued_at,
  ]))
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const hasFilters = !!search.trim() || (tab === 'visits' && status !== 'all')
  const clear = () => update({ search: '', status: 'all' })
  const activeReads = [appointments, tab === 'visits' ? treatments : invoices]
  const loading = activeReads.some(read => read.loading)
  const verified = tab === 'visits' ? !!(appointments.data && treatments.data) : verifiedReceipts
  const error = activeReads.find(read => read.error)?.error ||
    (tab === 'receipts' && loadedReceipts && !verifiedReceipts ? 'The returned receipt identities could not be verified.' : '')
  const refresh = () => activeReads.forEach(read => read.reload())

  const download = async (record, kind = 'receipt') => {
    if (downloadPending.current || !owns()) return
    downloadPending.current = true
    let active = true
    setDownloading(`${record.id}:${kind}`)
    const isCurrent = () => active && owns()
    try {
      const result = await boundedClinicalRead(() => record.isBookingDeposit
        ? downloadAppointmentReceiptPdf(record.appointmentId, record.appointmentCode, { patientId: record.patient.id, isCurrent })
        : downloadBillingPdf(record.id, kind, { patientId: record.patient.id, receiptId: kind === 'receipt' ? record.receipt.id : null, isCurrent }))
      if (owns() && !result.ok) toast?.(result.message || 'The saved PDF could not be downloaded.', 'warning')
    } finally {
      active = false
      downloadPending.current = false
      if (owns()) setDownloading('')
    }
  }

  return <div className="pp-page patient-history">
    <PageHead title="History" actions={<Button variant="soft" icon="tooth" onClick={() => onNavigate('teeth')}>My Teeth</Button>}/>
    <div className="patient-history-toolbar">
      <div className="pp-tabs" role="group" aria-label="History categories">
        {[['visits', 'Visits'], ['receipts', 'Receipts']].map(([key, label]) =>
          <button key={key} type="button" aria-pressed={tab === key} className={tab === key ? 'is-active' : ''}
            onClick={() => { if (key !== tab) update({ tab: key, search: '' }) }}>{label}</button>)}
      </div>
      {verified && <Button variant="ghost" size="sm" icon="refresh" disabled={loading} onClick={refresh}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
    </div>
    <FilterBar search={search} onSearchChange={value => update({ search: value })} searchPlaceholder={tab === 'visits' ? 'Search visits…' : 'Search receipts…'}
      filters={tab === 'visits' ? [{ label: 'Visit status', value: status, onChange: value => update({ status: value }),
        options: [{ value: 'all', label: 'All statuses' }, ...VISIT_STATUSES.filter(value => value === status || visits.some(row => row.status === value) || !['Confirmed', 'Pending'].includes(value)).map(value => ({ value, label: value }))] }] : []}
      onClear={hasFilters && rows.length ? clear : undefined}/>
    {loading && !verified && <LoadingState label={tab === 'visits' ? 'Loading visit history…' : 'Loading receipts…'}/>}
    {error && <ErrorState text={error} onRetry={refresh}/>}
    {verified && !error && !rows.length && <EmptyState icon={tab === 'visits' ? 'calendar' : 'receipt'}
      title={hasFilters ? (tab === 'visits' ? 'No matching visits' : 'No matching receipts') : (tab === 'visits' ? 'No past visits' : 'No receipts yet')}
      text={hasFilters ? 'Try a different search or clear your filters.' : undefined}>
      {hasFilters && <Button variant="soft" onClick={clear}>Clear filters</Button>}
    </EmptyState>}
    {rows.length > 0 && <ul className="patient-record-list" aria-label={tab === 'visits' ? 'Past visits and appointments' : 'Payment receipts'}>
      {tab === 'visits' ? rows.map(row => <li key={row.id} className="patient-record-row">
        <div className="patient-record-copy">
          <h2>{row.service?.name || 'Dental appointment'}</h2>
          <p>{[row.isTreatmentSummary ? 'Treatment summary' : row.branch?.name, row.dentist?.name].filter(Boolean).join(' · ')}</p>
          <p>{dateLong(row.date)}{row.start_time ? ` · ${time12(row.start_time)}` : ''}</p>
          {row.patient?.id && row.patient.id !== patientId && <p>For {row.patient.name}</p>}
        </div>
        <div className="patient-record-actions"><Pill>{row.status}</Pill>
          <Button variant="soft" size="sm" aria-label={`View ${row.isTreatmentSummary ? 'treatment summary' : 'appointment'} for ${row.service?.name}, ${dateLong(row.date)}`}
            onClick={() => setDetail(row)}>View details</Button></div>
      </li>) : rows.map(row => <li key={row.id} className="patient-record-row">
        <div className="patient-record-copy">
          <h2>{row.receipt.number}</h2>
          <p>{[row.isBookingDeposit ? 'Booking payment' : 'Payment Receipt', receiptDate(row.receipt.issued_at), row.branch?.name].filter(Boolean).join(' · ')}</p>
          {row.patient?.id !== patientId && <p>For {row.patient?.name}</p>}
        </div>
        <div className="patient-record-actions"><strong className="patient-number">{money(row.receipt.amount)}</strong>
          <Button size="sm" variant="soft" onClick={() => setDetail(row)}>View details</Button></div>
      </li>)}
    </ul>}
    {pageCount > 1 && <nav className="patient-pagination" aria-label="History pages">
      <Button size="sm" variant="soft" disabled={currentPage === 1} onClick={() => update({ page: currentPage - 1 })}>Previous</Button>
      <span role="status">Page {currentPage} of {pageCount}</span>
      <Button size="sm" variant="soft" disabled={currentPage === pageCount} onClick={() => update({ page: currentPage + 1 })}>Next</Button>
    </nav>}
    {detail && !detail.receipt && !detail.isTreatmentSummary && <AppointmentDetails id={detail.id} onClose={() => setDetail(null)}
      onChanged={appointments.reload} onNavigate={onNavigate} toast={toast} selectionDetailsAvailable={session?.selectionDetailsAvailable === true}/>}
    {detail?.isTreatmentSummary && <Modal open title="Treatment summary" onClose={() => setDetail(null)}>
      <p><strong>{detail.service.name}</strong></p><p>{dateLong(detail.date)} · {detail.dentist.name}</p>
    </Modal>}
    {detail?.receipt && <Modal open title="Payment Receipt" onClose={() => setDetail(null)}>
      <dl className="patient-profile-fields">
        <div><dt>Receipt number</dt><dd>{detail.receipt.number}</dd></div>
        <div><dt>Amount paid</dt><dd>{money(detail.receipt.amount)}</dd></div>
        <div><dt>Payment date</dt><dd>{receiptDate(detail.receipt.issued_at)}</dd></div>
        <div><dt>Payment method</dt><dd>{detail.receipt.method ? paymentMethodLabel(detail.receipt.method) : 'Not recorded'}</dd></div>
        <div><dt>Branch</dt><dd>{detail.branch?.name}</dd></div>
      </dl>
      <div className="pp-actions">
        <Button variant="soft" icon="download" disabled={!!downloading} onClick={() => download(detail)}>{downloading === `${detail.id}:receipt` ? 'Downloading…' : 'Download Receipt'}</Button>
        {!detail.isBookingDeposit && <Button variant="ghost" icon="download" disabled={!!downloading} onClick={() => download(detail, 'invoice')}>{downloading === `${detail.id}:invoice` ? 'Downloading…' : 'Invoice PDF'}</Button>}
        {!detail.isBookingDeposit && <Button variant="ghost" onClick={() => onNavigate('billing', { invoiceId: detail.id, patientId: detail.patient.id, receiptId: detail.receipt.id, receiptOnly: true })}>Open in billing</Button>}
      </div>
    </Modal>}
  </div>
}
export default ArchivesPage
