import React, { useEffect, useRef, useState } from 'react'
import { Button, Icon } from '../../components.jsx'
import { downloadBillingPdf, getBillingInvoice, myBillingInvoices, resendBillingReceipt } from '../../api-client.js'
import { confirmedBillingReceipt } from '../../billing-command.js'
import { paymentMethodLabel } from '../../payment-method.js'
import { useVisibleRefresh } from '../../use-visible-refresh.js'
import { ReviewAndPay } from '../../pages/ReviewAndPay.jsx'
import { dateLong, money } from '../format.js'
import { EmptyState, ErrorState, PageHead, Pill, Skeleton } from '../ui.jsx'

const view = i => ({ id: i.id, invoiceNo: i.invoice_number, date: i.issued_at || i.created_at, branch: i.branch?.name || '', status: i.status, total: i.gross_amount,
  discountType: i.discount_type, discountIdNumber: i.discount_id_number, discountAmount: i.discount_amount,
  hmoCoverage: i.hmo_coverage_amount, patientResponsibility: i.patient_responsibility_amount, paidAmount: i.paid_amount, balance: i.balance,
  settlementType: i.settlement_type || null,
  items: (i.lines || []).map(l => ({ key: l.id, name: l.service?.name || 'Service', quantity: l.quantity, unit: l.unit_price, amount: l.line_total })),
  receiptUnavailable: !!i.receipt && !confirmedBillingReceipt(i),
  receipt: confirmedBillingReceipt(i) ? { number: i.receipt.number, amount: i.receipt.amount, method: paymentMethodLabel(i.receipt.method), reference: i.receipt.external_reference || i.payment?.external_reference || null, paidAt: i.receipt.issued_at } : null })
const stamp = iso => iso ? `${dateLong(String(iso).slice(0, 10))}` : ''

/**
 * Billing: invoices the clinic issued and their receipts, from the server only. Coming back from PayMongo is not proof of payment:
 * an invoice shows Paid only after the server has the provider's verified confirmation (the same rule as before).
 */
export function BillingPage({ context, toast }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [cursor, setCursor] = useState(null), [more, setMore] = useState(false)
  const [reviewId, setReviewId] = useState(null), [openId, setOpenId] = useState(null), [attempt, setAttempt] = useState(0), [downloading, setDownloading] = useState(''), [resending, setResending] = useState('')
  const download = async (id, kind) => {
    setDownloading(`${id}:${kind}`)
    const r = await downloadBillingPdf(id, kind)
    setDownloading('')
    if (!r.ok) toast?.(r.message || 'The PDF could not be downloaded.', 'warning')
  }
  const resend = async id => {
    setResending(id)
    const r = await resendBillingReceipt(id)
    setResending('')
    if (!r.ok) {
      toast?.(r.message || 'The receipt email could not be sent.', 'warning')
      return
    }
    const status = r.data?.status
    const msg = status === 'transport_accepted'
      ? (r.data?.message || 'Receipt email accepted by mail server.')
      : status === 'logged_only'
        ? 'Receipt email was logged locally (not sent to an external inbox in this environment).'
        : status === 'suppressed'
          ? 'Receipt email was suppressed because this account uses a test email address.'
          : (r.data?.message || 'Receipt dispatch recorded (not sent externally).')
    toast?.(msg, status === 'transport_accepted' ? 'success' : 'info')
  }
  const linkId = typeof context?.invoiceId === 'string' ? context.invoiceId.toLowerCase() : null, linkPayment = context?.payment || null
  const [linkState, setLinkState] = useState(linkId && linkPayment ? 'checking' : null)
  const tries = useRef(0)
  const merge = row => setRows(prev => prev === null ? [row] : prev.some(p => p.id === row.id) ? prev.map(p => p.id === row.id ? row : p) : [row, ...prev])

  useEffect(() => {
    let live = true
    setError('')
    myBillingInvoices({ per_page: 25 }).then(r => {
      if (!live) return
      if (!r.ok) return setError(r.message || 'Your invoices could not be loaded.')
      const list = Array.isArray(r.data) ? r.data : []
      setRows(prev => [...list, ...(prev || []).filter(p => !list.some(x => x.id === p.id))]); setCursor(r.meta?.next_cursor || null)
    })
    return () => { live = false }
  }, [attempt])

  const checkLinked = async (first = false) => {
    const r = await getBillingInvoice(linkId)
    if (r.ok && r.data) {
      merge(r.data)
      if (r.data.status === 'Paid') { setLinkState(linkPayment ? 'paid' : null); return }
      if (linkPayment === 'cancelled') { setLinkState('cancelled'); return }
      if (first && !linkPayment && r.data.status === 'Issued' && Number(r.data.balance) > 0) { setReviewId(r.data.id); return }
    } else if (first && !linkPayment) { setLinkState('unavailable'); return }
    if (linkPayment === 'success' && ++tries.current >= 20) setLinkState('timeout')
  }
  useEffect(() => { if (linkId) checkLinked(true) }, [linkId, linkPayment])
  useVisibleRefresh(checkLinked, { active: linkState === 'checking' && linkPayment === 'success', intervalMs: 3000 })

  const loadOlder = async () => {
    setMore(true)
    const r = await myBillingInvoices({ per_page: 25, cursor })
    setMore(false)
    if (!r.ok) return toast?.(r.message || 'Older invoices could not be loaded.', 'warning')
    setRows(prev => [...prev, ...(r.data || []).filter(x => !prev.some(p => p.id === x.id))]); setCursor(r.meta?.next_cursor || null)
  }

  const items = (rows || []).map(view)
  const reviewing = reviewId ? items.find(i => i.id === reviewId) : null
  if (reviewing) return <div className="pp-page role-patient"><ReviewAndPay invoice={reviewing} onBack={() => setReviewId(null)}/></div>
  const due = items.filter(i => i.status === 'Issued' && Number(i.balance) > 0)
  const balance = due.reduce((s, i) => s + Number(i.balance), 0)

  return <div className="pp-page">
    <PageHead eyebrow="Billing" title="Invoices and receipts" text="Invoices appear after your visit. Pay online securely with PayMongo, or at the clinic."/>
    {linkState === 'checking' && <div className="pp-banner info" role="status"><Icon name="clock" size={18}/><span><b>Confirming your payment.</b> Your invoice shows as paid only after the clinic receives PayMongo’s confirmation. This usually takes a few seconds.</span></div>}
    {linkState === 'paid' && <div className="pp-banner ok" role="status"><Icon name="check" size={18}/><span><b>Payment received.</b> Your invoice is settled. Your Payment Receipt is available below.</span></div>}
    {linkState === 'timeout' && <div className="pp-banner warn" role="status"><Icon name="alert" size={18}/><span><b>Payment pending.</b> We have not received PayMongo’s confirmation yet. Check again in a few minutes; message the front desk if you were charged and it still shows unpaid.</span></div>}
    {linkState === 'cancelled' && <div className="pp-banner warn" role="status"><Icon name="alert" size={18}/><span><b>Payment cancelled.</b> Online checkout was cancelled. The invoice below shows the clinic’s current payment status.</span></div>}
    {linkState === 'unavailable' && <div className="pp-banner warn" role="status"><Icon name="alert" size={18}/><span>That invoice could not be opened from your account. Your invoices are listed below.</span></div>}

    {error && <ErrorState text={error} onRetry={() => setAttempt(a => a + 1)}/>}
    {!error && rows === null && <Skeleton lines={5} label="Loading your invoices"/>}
    {rows !== null && due.length > 0 && <div className="pp-card pp-balance pp-fade"><span>Balance to pay</span><b>{money(balance)}</b><small>{due.length === 1 ? '1 invoice' : `${due.length} invoices`}</small></div>}
    {rows !== null && !items.length && <EmptyState icon="receipt" title="No invoices yet" text="You’ll receive your invoice after your visit and can pay online here."/>}
    <ul className="pp-list">
      {items.map(inv => <li key={inv.id} className={`pp-card pp-invoice pp-fade ${linkId === inv.id ? 'is-focus' : ''}`}>
        <div className="pp-invoice-head"><div><h3>{inv.invoiceNo}</h3><p className="pp-muted">{stamp(inv.date)} · {inv.branch}</p></div><Pill>{inv.status}</Pill></div>
        <ul className="pp-lines" aria-label="Charges">{inv.items.map(l => <li key={l.key}><span>{l.name}<small>{l.quantity} × {money(l.unit)}</small></span><span>{money(l.amount)}</span></li>)}</ul>
        {Number(inv.discountAmount) > 0 && <p className="pp-row"><span>Less: 20% {inv.discountType || 'Statutory'} discount{inv.discountIdNumber ? ` (${inv.discountIdNumber})` : ''}</span><span>−{money(inv.discountAmount)}</span></p>}
        {Number(inv.hmoCoverage) > 0 && <p className="pp-row"><span>Less: coverage</span><span>−{money(inv.hmoCoverage)}</span></p>}
        {inv.status === 'Issued' && Number(inv.paidAmount) > 0 && <p className="pp-row"><span>Less: booking deposit applied</span><span>−{money(inv.paidAmount)}</span></p>}
        <p className="pp-row pp-total"><span>{inv.status === 'Paid' ? 'Paid' : 'To pay'}</span><b>{money(inv.status === 'Paid' ? inv.patientResponsibility ?? inv.total : inv.balance)}</b></p>
        <div className="pp-actions">
          {inv.receiptUnavailable && <p role="alert">The receipt could not be verified. Refresh or contact the front desk.</p>}
          {inv.status === 'Issued' && Number(inv.balance) > 0 && <Button onClick={() => setReviewId(inv.id)}>Review and pay</Button>}
          {['Issued', 'Paid'].includes(inv.status) && <Button size="sm" variant="soft" icon="download" disabled={downloading === `${inv.id}:receipt` || downloading === `${inv.id}:invoice`} onClick={() => download(inv.id, inv.receipt ? 'receipt' : 'invoice')}>
            {downloading === `${inv.id}:receipt` || downloading === `${inv.id}:invoice` ? 'Preparing…' : inv.receipt ? 'Download Receipt' : 'Download Invoice'}
          </Button>}
          {inv.receipt && <Button size="sm" variant="ghost" icon="mail" disabled={resending === inv.id} onClick={() => resend(inv.id)}>{resending === inv.id ? 'Sending…' : 'Resend receipt'}</Button>}
          {inv.receipt && <Button size="sm" variant="ghost" aria-expanded={openId === inv.id} aria-controls={`rct-${inv.id}`} onClick={() => setOpenId(openId === inv.id ? null : inv.id)}>{openId === inv.id ? 'Hide details' : 'View details'}</Button>}
        </div>
        {inv.receipt && openId === inv.id && <dl className="pp-summary pp-receipt" id={`rct-${inv.id}`}>
          {[
            ['Receipt number', inv.receipt.number],
            ...(inv.receipt.reference ? [['Payment reference', inv.receipt.reference]] : []),
            ...(inv.branch ? [['Branch', inv.branch]] : []),
            ['Payment status', inv.status === 'Paid' ? 'Paid in full' : inv.status],
            ['Amount paid', money(inv.receipt.amount)],
            ['Method', inv.receipt.method],
            ['Paid on', stamp(inv.receipt.paidAt)],
            ...(Number(inv.discountAmount) > 0 ? [['Discount', `20% ${inv.discountType || 'Statutory'}${inv.discountIdNumber ? ` (${inv.discountIdNumber})` : ''} (−${money(inv.discountAmount)})`]] : []),
            ...(Number(inv.hmoCoverage) > 0 ? [['HMO coverage', `−${money(inv.hmoCoverage)}`]] : []),
            ...(inv.settlementType === 'booking_deposit' || inv.settlementType === 'partial_booking_deposit' ? [['Adjustment', 'Booking deposit applied']] : []),
          ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          <p className="pp-hint">Download your Payment Receipt or request an email copy above. Email delivery is reported separately.</p>
        </dl>}
      </li>)}
    </ul>
    {rows !== null && cursor && <div className="pp-center"><Button variant="soft" disabled={more} onClick={loadOlder}>{more ? 'Loading…' : 'Load older invoices'}</Button></div>}
  </div>
}
