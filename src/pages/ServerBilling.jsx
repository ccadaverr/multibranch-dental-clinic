import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterBar, Modal, Notice, PageHeader, RefreshButton, Status } from '../components.jsx'
import * as api from '../api-client.js'
import { commandKey } from '../appointments-api.js'
import { cashCorrectionReasons, confirmedBillingReceipt, createBillingCommand } from '../billing-command.js'
import { clinicalSessionKey } from '../encounter.js'
import { dateLabel } from '../logic.js'

const sends = {
  draft: (i, guard) => api.createBillingDraft(i.base.id, i.key, guard),
  review: (i, guard) => api.reviewBillingInvoice(i.base.id, i.payload, i.key, guard),
  issue: (i, guard) => api.issueBillingInvoice(i.base.id, i.payload, i.key, guard),
  discount: (i, guard) => api.applyBillingDiscount(i.base.id, i.payload, i.key, guard),
  payment: (i, guard) => api.recordBillingPayment(i.base.id, i.payload, i.key, guard),
  closeCheckout: (i, guard) => api.closeInvoiceCheckout(i.base.id, i.payload, i.key, guard),
  cashReview: (i, guard) => api.requestCashCorrection(i.base.id, i.payload, i.key, guard),
  ackCashReview: (i, guard) => api.acknowledgeCashCorrection(i.base.id, i.payload, i.key, guard),
}
export function ServerBillingPage({ role, store }) {
  const auth = store.getAuthGeneration?.(), identity = clinicalSessionKey(store.session)
  return <BillingWorkspace key={identity + ':' + auth} role={role} store={store} identity={identity} auth={auth}/>
}
function BillingWorkspace({ role, store, identity, auth }) {
  const [rows, setRows] = useState(null), [treatments, setTreatments] = useState([]), [error, setError] = useState(''), [treatmentError, setTreatmentError] = useState('')
  const [nextCursor, setNextCursor] = useState(null), [loading, setLoading] = useState(false), [moreError, setMoreError] = useState('')
  const [search, setSearch] = useState(''), [status, setStatus] = useState('All'), [branch, setBranch] = useState('All')
  const [payment, setPayment] = useState(null), [method, setMethod] = useState('Cash'), [reference, setReference] = useState(''), [confirm, setConfirm] = useState(null)
  const [discount, setDiscount] = useState(null), [discountType, setDiscountType] = useState(''), [discountId, setDiscountId] = useState('')
  const [cashReview, setCashReview] = useState(null), [cashReason, setCashReason] = useState('')
  const [checkingCheckout, setCheckingCheckout] = useState(null)
  const [commandState, setCommandState] = useState({ pending: false, intent: null }), [problem, setProblem] = useState(null), [notice, setNotice] = useState('')
  const live = useRef(false), latest = useRef(store), readTicket = useRef(0), readPending = useRef(false), readAbort = useRef(null), command = useRef(null)
  latest.current = store
  const allowed = () => live.current && clinicalSessionKey(latest.current.session) === identity && auth === latest.current.getAuthGeneration?.()
  // Create inside the effect so StrictMode's cleanup cannot poison the next lifetime.
  useEffect(() => {
    live.current = true
    command.current = createBillingCommand({ send: i => sends[i.mode](i, allowed), read: api.getBillingInvoice, key: commandKey, allowed, publish: setCommandState })
    load()
    return () => { live.current = false; readTicket.current++; readPending.current = false; readAbort.current?.abort(); readAbort.current = null; command.current?.dispose() }
  }, [])
  async function load(cursor = null) {
    if (readPending.current || command.current?.state().pending) return
    const ticket = ++readTicket.current
    readPending.current = true; setLoading(true)
    // Bound only read-only requests. Never timeout or replay payment commands.
    const controller = new AbortController()
    readAbort.current = controller
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    if (cursor) setMoreError(''); else { setError(''); setTreatmentError('') }
    try {
      const [invoices, completed] = await Promise.all([api.listBillingInvoices({ per_page: 50, ...(cursor ? { cursor } : {}) }, controller.signal), cursor ? Promise.resolve(null) : api.listBillingTreatments(controller.signal)])
      if (!allowed() || ticket !== readTicket.current) return
      if (!invoices.ok) (cursor ? setMoreError : setError)(timedOut ? 'Payments took too long to load. Try again.' : invoices.message || 'Billing records could not be loaded.')
      else {
        setRows(previous => cursor ? [...(previous || []), ...(invoices.data || []).filter(row => !(previous || []).some(p => p.id === row.id))] : invoices.data || [])
        setNextCursor(invoices.meta?.next_cursor || null)
      }
      if (completed) completed.ok ? setTreatments(completed.data || []) : setTreatmentError(timedOut ? 'Treatment records took too long to load. Retry.' : completed.message || 'Completed treatments could not be loaded.')
    } catch { if (allowed()) (cursor ? setMoreError : setError)(timedOut ? 'Payments took too long to load. Try again.' : 'Billing records could not be loaded. Retry when the connection is available.') }
    finally {
      clearTimeout(timeout)
      if (readAbort.current === controller) readAbort.current = null
      if (ticket === readTicket.current) { readPending.current = false; if (allowed()) setLoading(false) }
    }
  }
  async function run(mode, base, payload = {}) {
    const action = mode ?? command.current?.state().intent?.mode
    if (readPending.current || !allowed() || !action || role !== (action === 'ackCashReview' ? 'owner' : 'staff')) return
    setProblem(null); setNotice('')
    const result = await command.current.run(mode ? { mode, base, payload: mode === 'draft' ? {} : { expected_revision: base.revision, ...payload } } : undefined)
    if (!allowed() || result.ignored) return
    if (!result.ok) {
      setProblem(result)
      if (result.code === 'checkout_reconciliation_required') { setPayment(null); load() }
      return
    }
    setRows(previous => [result.data, ...(previous || []).filter(i => i.id !== result.data.id)])
    setTreatments(previous => previous.map(t => t.id === result.data.treatment_id ? { ...t, billing_state: 'already_invoiced', invoice: result.data.id } : t))
    setPayment(null); setConfirm(null); setDiscount(null); setCashReview(null)
    setNotice(action === 'cashReview' ? 'Cash correction review requested.' :
      action === 'ackCashReview' ? 'Cash correction review acknowledged. The original collection is unchanged.' :
        action === 'closeCheckout' ? 'PayMongo confirmed the checkout was closed without a payment.' :
        result.data.receipt ? `Payment confirmed. Receipt ${result.data.receipt.number}.` : `Invoice ${result.data.invoice_number}: ${result.data.status}.`)
  }
  async function checkCheckout(invoice) {
    if (readPending.current || !allowed() || command.current?.state().intent) return
    readPending.current = true
    const controller = new AbortController()
    readAbort.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    setCheckingCheckout(invoice.id); setProblem(null); setNotice('')
    try {
      const result = await api.getBillingInvoice(invoice.id, controller.signal)
      if (!allowed() || controller.signal.aborted) return
      const current = result.data
      if (!result.ok || current?.id !== invoice.id || current.patient?.id !== invoice.patient?.id || current.branch?.id !== invoice.branch?.id) {
        setProblem({ message: result.message || 'The checked invoice could not be verified. Try again before collecting payment.' })
        return
      }
      setRows(previous => previous?.map(row => row.id === current.id && row.revision <= current.revision ? current : row))
      setNotice(confirmedBillingReceipt(current)
        ? `Payment confirmed. Receipt ${current.receipt.number}.`
        : 'No settlement could be confirmed. Review the online checkout before collecting at the counter.')
    } catch {
      if (allowed() && !controller.signal.aborted) setProblem({ message: 'Payment status could not be checked. Retry before collecting payment.' })
    } finally {
      clearTimeout(timeout)
      if (readAbort.current === controller) {
        readAbort.current = null
        readPending.current = false
        if (allowed()) {
          if (controller.signal.aborted) setProblem({ message: 'The payment status check timed out. Retry before collecting payment.' })
          setCheckingCheckout(null)
        }
      }
    }
  }
  const locked = loading || !!checkingCheckout || !!error || commandState.pending || !!commandState.intent
  const filtered = (rows || []).filter(i => (status === 'All' || i.status === status) && (branch === 'All' || i.branch?.id === branch) && (!search.trim() || [i.patient?.name, i.patient?.code, i.invoice_number, i.receipt?.number].some(s => s?.toLowerCase().includes(search.trim().toLowerCase()))))
  const ready = treatments.filter(t => t.billing_state !== 'already_invoiced')
  const confirmationTitles = {
    issue: 'Issue this invoice?', payment: 'Record payment and issue receipt?',
    ackCashReview: 'Acknowledge Cash review?', closeCheckout: 'Close the unused online checkout?',
  }
  const confirmationText = confirm && {
    issue: `Issue the reviewed invoice for ₱${confirm.base.patient_responsibility_amount} PHP. Issued invoices cannot be edited.`,
    payment: confirm.payload && `Confirm the at-clinic collection of ₱${confirm.payload.amount} PHP by ${confirm.payload.method}. A receipt is shown after the saved result is verified.`,
    ackCashReview: confirm.base.receipt && `Acknowledge review of receipt ${confirm.base.receipt.number}. This action leaves the collection unchanged.`,
    closeCheckout: 'The counter stays on hold until PayMongo verifies the checkout is closed and unpaid.',
  }[confirm.mode]
  const confirmationLabel = confirm?.mode === 'payment' ? `Confirm ₱${confirm.payload.amount} ${confirm.payload.method}` :
    { issue: 'Issue invoice', ackCashReview: 'Acknowledge review', closeCheckout: 'Close checkout' }[confirm?.mode]
  const download = async i => { const r = await api.downloadBillingPdf(i.id, i.receipt ? 'receipt' : 'invoice'); if (allowed() && !r.ok) setProblem(r) }
  const feedback = problem && <Notice tone="warning" title="Action not confirmed"><p>{problem.message || 'The action could not be confirmed.'}</p>{commandState.intent && <><p>The original request is retained. Retry sends the same request; do not collect payment again.</p><Button disabled={commandState.pending} onClick={() => run()}>Retry same command</Button><Button variant="ghost" disabled={commandState.pending} onClick={() => window.location.reload()}>Reload billing</Button></>}</Notice>
  return <>
    <PageHeader title="Billing & Payments" text="Completed treatment → draft → review → issue → payment receipt. Amounts are in Philippine pesos (PHP)." aside={<RefreshButton disabled={locked} onClick={() => load()}/>}/>
    {notice && <p role="status">{notice}</p>}
    {!payment && !discount && !cashReview && feedback}
    {commandState.pending && <p role="status">Saving and verifying the clinic record…</p>}
    {error && <Notice tone="warning" title="Billing records unavailable">{error} <Button disabled={loading} onClick={() => load()}>Retry</Button></Notice>}
    {rows === null && !error && <p className="ui-read-status" role="status" aria-live="polite">Loading payments…</p>}
    <Card title="Completed treatments awaiting billing">
      {treatmentError && <Notice tone="warning">{treatmentError} <Button disabled={locked} onClick={() => load()}>Retry</Button></Notice>}
      <div className="billing-worklist">{ready.map(t => <div className="billing-worklist-row" key={t.id}>
        <span className="billing-worklist-patient"><b>{t.patient?.name}</b><small>{t.branch?.name} • {(t.services || []).map(s => `${s.name} × ${s.quantity}`).join(', ')}</small></span>
        {t.billing_state === 'pricing_unavailable' ? <Notice tone="warning">Pricing unavailable: {(t.pricing_unavailable || []).map(s => s.name).join(', ')}</Notice> : role === 'staff' && <Button disabled={locked} onClick={() => run('draft', t)}>Create Draft</Button>}
      </div>)}</div>
      {rows !== null && !loading && !treatmentError && !ready.length && <Notice>No completed treatments are awaiting billing.</Notice>}
    </Card>
    <Card title={role === 'staff' ? 'Branch payment worklist' : 'Financial oversight'}>
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search patient, invoice or receipt" onClear={search || status !== 'All' || branch !== 'All' ? () => { setSearch(''); setStatus('All'); setBranch('All') } : null}>
        <select aria-label="Filter invoices by status" value={status} onChange={e => setStatus(e.target.value)}>{['All', 'Draft', 'Review', 'Issued', 'Paid'].map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter invoices by branch" value={branch} onChange={e => setBranch(e.target.value)}><option value="All">All branches</option>{[...new Map((rows || []).filter(i => i.branch).map(i => [i.branch.id, i.branch])).values()].map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </FilterBar>
      <div className="billing-worklist">{filtered.map(i => <details className="billing-worklist-item" key={i.id}>
        <summary className="billing-worklist-row"><span className="billing-worklist-patient"><b>{i.patient?.name}</b><small>{i.patient?.code} • {i.invoice_number}</small></span><strong>₱{i.gross_amount}</strong><Status>{i.status}</Status></summary>
        <div className="billing-worklist-detail">
          <p><b>Branch:</b> {i.branch?.name} • <b>Revision:</b> {i.revision}</p>
          <ul aria-label="Itemized charges">{(i.lines || []).map(l => <li key={l.id}>{l.service?.name} • {l.quantity} × ₱{l.unit_price} = <b>₱{l.line_total}</b></li>)}</ul>
          <p><b>Patient responsibility:</b> ₱{i.patient_responsibility_amount} • <b>Paid / credited:</b> ₱{i.paid_amount} • <b>Balance:</b> ₱{i.balance}</p>
          {i.booking_credit && <p><b>Booking deposit applied:</b> ₱{i.booking_credit.applied_php}
            {i.booking_credit.receipt_number && <> · {i.booking_credit.receipt_number}</>}
            {Number(i.booking_credit.unapplied_php) > 0 && <> · <b>Unapplied deposit:</b> ₱{i.booking_credit.unapplied_php} · Requires reconciliation</>}
          </p>}
          {Number(i.discount_amount) > 0 && <p>{i.discount_type} discount: −₱{i.discount_amount}</p>}
          {i.hmo_status && <p>HMO: {i.hmo_status}{i.settlement_type === 'full_hmo_coverage' ? ' • Fully covered; no payment collected.' : ''}</p>}
          {i.receipt && <p><b>Payment Receipt:</b> {i.receipt.number} • ₱{i.receipt.amount} • {i.receipt.method} • {dateLabel(i.receipt.issued_at)}{i.receipt.external_reference ? ` • ${i.receipt.external_reference}` : ''}</p>}
          {['partially_refunded', 'refunded'].includes(i.refund_status) && <p>Refund recorded: {i.refund_status === 'refunded' ? 'Full refund' : 'Partial refund'}</p>}
          {i.cash_correction && <p><b>Cash correction review:</b> {i.cash_correction.status === 'requested' ? 'Awaiting Owner review' : 'Acknowledged by Owner'} · {cashCorrectionReasons[i.cash_correction.reason]} · {dateLabel(i.cash_correction.occurred_at)}</p>}
          {i.status === 'Issued' && i.has_open_checkout && <Notice tone="warning">Online checkout is open. Counter collection is on hold until the checkout is resolved.</Notice>}
          <div className="row-actions">
            {role === 'staff' && ['Draft', 'Review'].includes(i.status) && <Button disabled={locked} variant="soft" onClick={() => { setDiscount(i); setDiscountType(i.discount_type || ''); setDiscountId(i.discount_id_number || '') }}>Senior/PWD Discount</Button>}
            {role === 'staff' && i.status === 'Draft' && <Button disabled={locked} onClick={() => run('review', i)}>Review Invoice</Button>}
            {role === 'staff' && i.status === 'Review' && <Button disabled={locked} onClick={() => setConfirm({ mode: 'issue', base: i })}>Issue Invoice</Button>}
            {role === 'staff' && i.status === 'Issued' && !i.has_open_checkout && <Button disabled={locked} onClick={() => { setPayment(i); setMethod('Cash'); setReference('') }}>Record full payment</Button>}
            {i.status === 'Issued' && i.has_open_checkout && <Button variant="soft" disabled={locked} onClick={() => checkCheckout(i)}>{checkingCheckout === i.id ? 'Checking payment…' : 'Check online payment status'}</Button>}
            {i.can_close_checkout && <Button variant="ghost" disabled={locked} onClick={() => setConfirm({ mode: 'closeCheckout', base: i })}>Close unused checkout</Button>}
            {role === 'staff' && i.cash_review_available && <Button variant="soft" disabled={locked} onClick={() => { setCashReview(i); setCashReason(''); setProblem(null) }}>Request Cash review</Button>}
            {role === 'owner' && i.cash_correction?.status === 'requested' && <Button variant="soft" disabled={locked} onClick={() => setConfirm({ mode: 'ackCashReview', base: i })}>Acknowledge Cash review</Button>}
            {['Issued', 'Paid'].includes(i.status) && <Button variant="soft" onClick={() => download(i)}>Download {i.receipt ? 'Receipt' : 'Invoice'}</Button>}
          </div>
        </div>
      </details>)}</div>
      {rows && !filtered.length && <Notice>{rows.length ? 'No invoices match your selected filters.' : 'No authoritative invoices are available in this scope.'}</Notice>}
      {rows && <p role="status">Showing {filtered.length} of {rows.length} loaded invoices. {nextCursor ? 'Older invoices are available.' : 'That is all invoices in your scope.'}</p>}
      {moreError && <Notice tone="warning" title="Older invoices unavailable">{moreError}</Notice>}
      {nextCursor && <Button disabled={locked} onClick={() => load(nextCursor)}>{loading ? 'Loading…' : 'Load older invoices'}</Button>}
    </Card>
    {payment && <Modal open title="Record full payment" onClose={() => !commandState.pending && setPayment(null)}>
      {feedback}
      <p><b>{payment.patient?.name}</b> • {payment.invoice_number} • {payment.branch?.name}</p><p>Full balance: <b>₱{payment.balance} PHP</b></p>
      <Notice>Record payment only after collection at the clinic. This action records the collection and issues a Payment Receipt.</Notice>
      <form onSubmit={e => { e.preventDefault(); if (!locked) setConfirm({ mode: 'payment', base: payment, payload: { method, external_reference: reference.trim() || null, amount: payment.balance } }) }}>
        <Field label="Payment method"><select aria-label="Payment method" disabled={locked} value={method} onChange={e => setMethod(e.target.value)}>{['Cash', 'Card/POS', 'Bank Transfer', 'E-Wallet'].map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="External reference" required={method !== 'Cash'}><input aria-label="External reference" required={method !== 'Cash'} maxLength={160} disabled={locked} value={reference} onChange={e => setReference(e.target.value)}/></Field>
        <Button type="submit" disabled={locked}>Record ₱{payment.balance}</Button>
      </form>
    </Modal>}
    {discount && <Modal open title="Senior/PWD Discount" onClose={() => !commandState.pending && setDiscount(null)}>
      {feedback}
      <p>{discount.patient?.name} • {discount.invoice_number}</p>
      <form onSubmit={e => { e.preventDefault(); run('discount', discount, { discount_type: discountType || null, discount_id_number: discountType ? discountId.trim() : null }) }}>
        <Field label="Discount Type"><select aria-label="Discount Type" disabled={locked} value={discountType} onChange={e => setDiscountType(e.target.value)}><option value="">None</option><option>Senior Citizen</option><option>PWD</option></select></Field>
        <Field label="Senior / PWD ID Number" required={!!discountType}><input aria-label="Senior / PWD ID Number" required={!!discountType} disabled={locked} maxLength={50} value={discountId} onChange={e => setDiscountId(e.target.value)}/></Field>
        <Button type="submit" disabled={locked}>Save Discount</Button>
      </form>
    </Modal>}
    {cashReview && <Modal open title="Request Cash correction review" onClose={() => !commandState.pending && setCashReview(null)}>
      {feedback}
      <p>{cashReview.patient?.name} · {cashReview.invoice_number} · {cashReview.branch?.name}</p>
      <p>Original collection <b>₱{cashReview.receipt.amount}</b> · Receipt {cashReview.receipt.number}</p>
      <Notice>This sends the collection for Owner review. The recorded payment, receipt, and balance stay unchanged.</Notice>
      <form onSubmit={e => { e.preventDefault(); if (!locked && cashReason) run('cashReview', cashReview, { reason: cashReason }) }}>
        <Field label="Review reason" required><select aria-label="Review reason" value={cashReason} disabled={locked} required onChange={e => setCashReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {Object.entries(cashCorrectionReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></Field>
        <Button type="submit" disabled={locked || !cashReason}>Send for review</Button>
      </form>
    </Modal>}
    <ConfirmDialog open={!!confirm} title={confirmationTitles[confirm?.mode]} confirmLabel={confirmationLabel} onCancel={() => !locked && setConfirm(null)} onConfirm={() => { const c = confirm; if (c && !locked) { setConfirm(null); run(c.mode, c.base, c.payload) } }}>
      {confirm && <p>{confirm.base.patient?.name} • {confirm.base.invoice_number} • {confirm.base.branch?.name}. {confirmationText}</p>}
    </ConfirmDialog>
  </>
}
