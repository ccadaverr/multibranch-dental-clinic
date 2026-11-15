import React, { useEffect, useRef, useState } from 'react'
import { Button, Icon, RefreshButton } from '../../components.jsx'
import { downloadBillingPdf, getBillingInvoice, myBillingInvoices, resendBillingReceipt, myDependents } from '../../api-client.js'
import { confirmedBillingReceipt } from '../../billing-command.js'
import { paymentMethodLabel } from '../../payment-method.js'
import { useVisibleRefresh } from '../../use-visible-refresh.js'
import { ReviewAndPay } from '../../pages/ReviewAndPay.jsx'
import { dateLong, money } from '../format.js'
import { EmptyState, ErrorState, PageHead, Pill, Skeleton } from '../ui.jsx'
import {invoiceMatches,verifiedPaid,boundedInvoice} from '../invoice-readback.js'

const view = i => ({ id: i.id, patientId:i.patient?.id,visitId:i.visit_id,appointmentId:i.appointment_id,visitSource:i.visit_source,visitDate:i.visit_date,invoiceNo: i.invoice_number, date: i.issued_at || i.created_at, branch: i.branch?.name || '', status: i.status==='Paid'&&!verifiedPaid(i)?'Payment status unverified':i.status, total: i.gross_amount,
  discountType: i.discount_type, discountIdNumber: i.discount_id_number, discountAmount: i.discount_amount,
  hmoCoverage: i.hmo_coverage_amount, patientResponsibility: i.patient_responsibility_amount, paidAmount: i.paid_amount, balance: i.balance,
  settlementType: i.settlement_type || null,
  items: (i.lines || []).map(l => ({ key: l.id, name: l.service?.name || 'Service', quantity: l.quantity, unit: l.unit_price, amount: l.line_total })),
  receiptUnavailable: i.status==='Paid'&&!verifiedPaid(i)||!!i.receipt&&!confirmedBillingReceipt(i),
  receipt: confirmedBillingReceipt(i) ? { id:i.receipt.id,number: i.receipt.number, amount: i.receipt.amount, method: paymentMethodLabel(i.receipt.method), reference: i.receipt.external_reference || i.payment?.external_reference || null, paidAt: i.receipt.issued_at } : null })
const stamp = iso => iso ? `${dateLong(String(iso).slice(0, 10))}` : ''

/**
 * Billing: invoices the clinic issued and their receipts, from the server only. Coming back from PayMongo is not proof of payment:
 * an invoice shows Paid only after the server has the provider's verified confirmation (the same rule as before).
 */
export function BillingPage({ context, toast,session,getAuthGeneration,onNavigate }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [cursor, setCursor] = useState(null), [more, setMore] = useState(false)
  const [reviewId, setReviewId] = useState(null), [openId, setOpenId] = useState(null), [attempt, setAttempt] = useState(0), [downloading, setDownloading] = useState(''), [resending, setResending] = useState('')
  const live=useRef(false),allowed=useRef(null),checking=useRef(false),older=useRef(false),downloads=useRef(false),latest=useRef(null),readGeneration=useRef(0)
  const generation=getAuthGeneration?.(),owner=JSON.stringify([session?.serverUserId,session?.patientPublicId,generation]);latest.current=owner
  const owns=()=>live.current&&latest.current===owner&&session?.role==='patient'&&session?.active===true&&(!getAuthGeneration||generation!=null&&generation===getAuthGeneration())
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  const reload=()=>{readGeneration.current++;allowed.current=null;setAttempt(a=>a+1)}
  const constraints={appointmentId:context?.appointmentId||null,patientId:context?.patientId||null,receiptId:context?.receiptId||null}
  const download = async (inv, kind) => {
    if(downloads.current||!owns())return
    downloads.current=true
    const id=inv.id;let active=true
    setDownloading(`${id}:${kind}`)
    const r = await boundedInvoice(()=>downloadBillingPdf(id, kind,{receiptId:kind==='receipt'?inv.receipt?.id:null,patientId:inv.patientId,isCurrent:()=>active&&owns()}))
    active=false;downloads.current=false
    if(!owns())return
    setDownloading('')
    if (!r.ok) toast?.(r.message || 'The PDF could not be downloaded.', 'warning')
  }
  const resend = async id => {
    if(!owns())return
    setResending(id)
    const r = await resendBillingReceipt(id)
    if(!owns())return
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
    let current = true;const epoch=++readGeneration.current
    setError('');setRows(null);setCursor(null);setLinkState(linkId&&linkPayment?'checking':null);allowed.current=null
    if(!owns()){setError('Your Patient billing session is unavailable. Sign in again.');return}
    boundedInvoice(()=>Promise.all([myDependents(),myBillingInvoices({ per_page:25,appointment_id:constraints.appointmentId})])).then(result => {
      if (!current||!owns()||epoch!==readGeneration.current) return
      if(!Array.isArray(result))return setError(result.message||'Your invoices could not be loaded.')
      const [family,r]=result
      if(!family.ok||!Array.isArray(family.data))return setError('Authorized Patient context could not be verified. Retry before opening receipts.')
      allowed.current=[session.patientPublicId,...family.data.map(p=>p.id)]
      if (!r.ok||!Array.isArray(r.data)) return setError(r.message || 'Your invoices could not be loaded.')
      const list = r.data.filter(i=>!linkId||i.id===linkId)
      if(list.some(i=>!invoiceMatches(i,allowed.current,constraints)))return setError('The returned invoice context could not be verified. No receipt was adopted.')
      setRows(list); setCursor(linkId?null:r.meta?.next_cursor || null)
      if(constraints.appointmentId&&list.length===1&&confirmedBillingReceipt(list[0]))setOpenId(list[0].id)
      if(linkId)checkLinked(true)
    })
    return () => { current = false }
  }, [attempt,owner,constraints.appointmentId])

  const checkLinked = async (first = false) => {
    if(!linkId||!owns()||!allowed.current||checking.current)return
    checking.current=true;const epoch=readGeneration.current
    const r = await boundedInvoice(()=>getBillingInvoice(linkId));checking.current=false
    if(!owns()||epoch!==readGeneration.current)return
    if (r.ok && invoiceMatches(r.data,allowed.current,{...constraints,invoiceId:linkId,receiptId:context?.receiptId||null})) {
      merge(r.data)
      if (verifiedPaid(r.data)) { setLinkState(linkPayment ? 'paid' : null);if(context?.receiptId||context?.receiptOnly)setOpenId(r.data.id); return }
      if (linkPayment === 'cancelled') { setLinkState('cancelled'); return }
      if (first && !linkPayment && !context?.receiptOnly && r.data.status === 'Issued' && Number(r.data.balance) > 0) { setReviewId(r.data.id); return }
    } else if (first && !linkPayment) { setLinkState('unavailable'); return }
    if (linkPayment === 'success' && ++tries.current >= 20) setLinkState('timeout')
  }
  useEffect(() => { tries.current=0;if(linkId){setLinkState(linkPayment?'checking':null);checkLinked(true)} }, [linkId, linkPayment])
  useVisibleRefresh(checkLinked, { active: linkState === 'checking' && linkPayment === 'success', intervalMs: 3000 })

  const loadOlder = async () => {
    if(older.current||!owns()||!allowed.current)return
    older.current=true;const epoch=readGeneration.current
    setMore(true)
    const r = await boundedInvoice(()=>myBillingInvoices({ per_page:25,cursor,appointment_id:constraints.appointmentId}));older.current=false
    if(!owns()||epoch!==readGeneration.current)return
    setMore(false)
    if (!r.ok||!Array.isArray(r.data)||r.data.some(i=>!invoiceMatches(i,allowed.current,constraints))) return toast?.(r.message || 'Older invoice identities could not be verified.', 'warning')
    setRows(prev => [...prev, ...(r.data || []).filter(x => !prev.some(p => p.id === x.id))]); setCursor(r.meta?.next_cursor || null)
  }

  const items = (rows || []).map(view)
  const reviewing = reviewId ? items.find(i => i.id === reviewId) : null
  if (reviewing) return <div className="pp-page role-patient"><ReviewAndPay invoice={reviewing} onBack={() => setReviewId(null)}/></div>
  const due = items.filter(i => i.status === 'Issued' && Number(i.balance) > 0)
  const balance = due.reduce((s, i) => s + Number(i.balance), 0)

  return <div className="pp-page">
    <PageHead eyebrow="Billing" title="Invoices and receipts" text="Saved invoices and payment receipts from the clinic." actions={<RefreshButton title="Reload billing records" ariaLabel="Reload billing records" onClick={reload}/>}/>
    {constraints.appointmentId&&<p>Billing for the selected appointment. <Button variant="ghost" onClick={()=>onNavigate?.('visits',{appointmentId:constraints.appointmentId})}>Return to appointment</Button></p>}
    {linkState === 'checking' && <div className="pp-banner info" role="status"><Icon name="clock" size={18}/><span><b>Confirming your payment.</b> Your invoice shows as paid only after the clinic receives PayMongo’s confirmation. This usually takes a few seconds.</span></div>}
    {linkState === 'paid' && <div className="pp-banner ok" role="status"><Icon name="check" size={18}/><span><b>Payment received.</b> Your invoice is settled. Your Payment Receipt is available below.</span></div>}
    {linkState === 'timeout' && <div className="pp-banner warn" role="status"><Icon name="alert" size={18}/><span><b>Payment pending.</b> We have not received PayMongo’s confirmation yet. Check again in a few minutes; message the front desk if you were charged and it still shows unpaid.</span></div>}
    {linkState === 'cancelled' && <div className="pp-banner warn" role="status"><Icon name="alert" size={18}/><span><b>Payment cancelled.</b> Online checkout was cancelled. The invoice below shows the clinic’s current payment status.</span></div>}
    {linkState === 'unavailable' && <div className="pp-banner warn" role="status"><Icon name="alert" size={18}/><span>That invoice could not be opened from your account. Your invoices are listed below.</span></div>}

    {error && <ErrorState text={error} onRetry={reload}/>}
    {!error && rows === null && <Skeleton lines={5} label="Loading your invoices"/>}
    {rows !== null && due.length > 0 && <div className="pp-card pp-balance pp-fade"><span>Balance to pay</span><b>{money(balance)}</b><small>{due.length === 1 ? '1 invoice' : `${due.length} invoices`}</small></div>}
    {rows !== null && !items.length && <EmptyState icon="receipt" title="No invoices returned" text={constraints.appointmentId?'No authorized invoice was returned for this appointment. This does not confirm that a payment was made.':'No authorized invoices were returned. Retry or contact the front desk if a saved invoice is missing.'}/>}
    <ul className="pp-list">
      {items.map(inv => <li key={inv.id} id={`invoice-${inv.id}`} data-receipt-id={inv.receipt?.id||undefined} className={`pp-card pp-invoice pp-fade ${linkId === inv.id||constraints.appointmentId ? 'is-focus' : ''}`}>
        <div className="pp-invoice-head"><div><h3>{inv.invoiceNo}</h3><p className="pp-muted">{stamp(inv.date)} · {inv.branch}</p></div><Pill>{inv.status}</Pill></div>
        <ul className="pp-lines" aria-label="Charges">{inv.items.map(l => <li key={l.key}><span>{l.name}<small>{l.quantity} × {money(l.unit)}</small></span><span>{money(l.amount)}</span></li>)}</ul>
        {Number(inv.discountAmount) > 0 && <p className="pp-row"><span>Less: 20% {inv.discountType || 'Statutory'} discount{inv.discountIdNumber ? ` (${inv.discountIdNumber})` : ''}</span><span>−{money(inv.discountAmount)}</span></p>}
        {Number(inv.hmoCoverage) > 0 && <p className="pp-row"><span>Less: coverage</span><span>−{money(inv.hmoCoverage)}</span></p>}
        {inv.status === 'Issued' && Number(inv.paidAmount) > 0 && <p className="pp-row"><span>Less: booking deposit applied</span><span>−{money(inv.paidAmount)}</span></p>}
        <p className="pp-row pp-total"><span>{inv.status === 'Paid' ? 'Paid' : 'To pay'}</span><b>{money(inv.status === 'Paid' ? inv.patientResponsibility ?? inv.total : inv.balance)}</b></p>
        <div className="pp-actions">
          {inv.receiptUnavailable && <p role="alert">The receipt could not be verified. Refresh or contact the front desk.</p>}
          {inv.status === 'Issued' && Number(inv.balance) > 0 && <Button onClick={() => setReviewId(inv.id)}>Review and pay</Button>}
          {['Issued', 'Paid'].includes(inv.status) && <Button size="sm" variant="soft" icon="download" disabled={downloading === `${inv.id}:receipt` || downloading === `${inv.id}:invoice`} onClick={() => download(inv, inv.receipt ? 'receipt' : 'invoice')}>
            {downloading === `${inv.id}:receipt` || downloading === `${inv.id}:invoice` ? 'Preparing…' : inv.receipt ? 'Download Receipt' : 'Download Invoice'}
          </Button>}
          {inv.receipt && <Button size="sm" variant="ghost" icon="mail" disabled={resending === inv.id} onClick={() => resend(inv.id)}>{resending === inv.id ? 'Sending…' : 'Resend receipt'}</Button>}
          {inv.receipt && <Button size="sm" variant="ghost" aria-expanded={openId === inv.id} aria-controls={`rct-${inv.id}`} onClick={() => setOpenId(openId === inv.id ? null : inv.id)}>{openId === inv.id ? 'Hide details' : 'View details'}</Button>}
          {inv.appointmentId&&<Button size="sm" variant="ghost" onClick={()=>onNavigate?.('visits',{appointmentId:inv.appointmentId})}>Associated appointment</Button>}
        </div>
        {inv.visitSource==='walk_in'&&<p className="pp-hint">Walk-in Visit — no appointment is linked.</p>}
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
