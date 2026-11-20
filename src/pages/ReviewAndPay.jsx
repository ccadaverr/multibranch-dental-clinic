import React, { useEffect, useRef, useState } from 'react'
import { Button, Field, Notice } from '../components.jsx'
import { clinic } from '../clinic-config.js'
import { dateLabel } from '../logic.js'
import { money } from '../patient-view.js'
import { createPayMongoCheckout, getPaymentOptions } from '../api-client.js'
import { ADDRESS_LABELS as LABELS, billingAddressErrors } from '../billing-address.js'
import { startHomeRead } from '../home-read-deadline.js'
import { paymentOptionsProjection } from '../payment-options-read.js'
import { moneyMinor } from '../billing-command.js'


/**
 * M11 Review and Pay: the Patient checks the itemized invoice, optionally gives a billing address, and is sent to PayMongo's hosted
 * checkout. The server builds the amount, the line items and the return URLs; this page only displays what the server returned.
 */
export function ReviewAndPay({ invoice, onBack }) {
  const [optionResult, setOptionResult] = useState(null), [optionAttempt, setOptionAttempt] = useState(0)
  const [addressState, setAddressState] = useState(null), [save, setSave] = useState(false)
  const [errors, setErrors] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const scope = JSON.stringify([invoice.id, invoice.patientId, invoice.visitId, invoice.appointmentId, invoice.status, invoice.balance])
  const live = useRef(false), pendingCheckout = useRef(false), currentScope = useRef(scope)
  currentScope.current = scope
  const owns = key => live.current && currentScope.current === key
  const current = optionResult?.scope === scope && optionResult?.attempt === optionAttempt ? optionResult : null
  const options = current?.data || null
  const optionsError = current?.error || ''
  const address = addressState?.id === invoice.id ? addressState.value : null
  // Only a currently issued, positive, exact-centavo invoice can open a checkout.
  // Status is still revalidated by Laravel before any provider call.
  const payable = invoice.status === 'Issued' && moneyMinor(invoice.balance) > 0

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  useEffect(() => {
    let active = true
    const id = invoice.id, attempt = optionAttempt, key = scope
    setOptionResult(null)
    if (!payable) return undefined
    const task = startHomeRead(signal => getPaymentOptions(id, signal), {
      timeoutMs: 12000, timeoutMessage: 'Payment options took too long to load. Please retry.',
    })
    task.response.then(result => {
      if (!active || !owns(key)) return
      const projected = result?.ok ? paymentOptionsProjection(result.data) : null
      if (!projected) {
        setOptionResult({ scope: key, attempt, error: result?.ok
          ? 'Payment options could not be verified. No checkout was started.'
          : result?.message || 'Payment options are unavailable. Please retry.' })
        return
      }
      // Refreshing methods never discards an address the Patient already typed.
      setAddressState(previous => previous?.id === id ? previous : { id, value: projected.billing_address })
      setOptionResult({ scope: key, attempt, data: projected })
    }).catch(failure => {
      if (active && owns(key)) setOptionResult({ scope: key, attempt, error: failure.message || 'Payment options are unavailable. Please retry.' })
    })
    return () => { active = false; task.cancel() }
  }, [scope, optionAttempt, payable])
  useEffect(() => { setSave(false); setErrors({}); setError('') }, [invoice.id])

  const set = key => event => {
    const value = event.target.value, id = invoice.id
    setAddressState(previous => ({ id, value: {
      ...(previous?.id === id ? previous.value : options?.billing_address || { country: 'PH' }),
      [key]: value,
    } }))
  }
  const pay = async event => {
    event.preventDefault()
    if (pendingCheckout.current || !payable || !options || !owns(scope)) return
    const checked = billingAddressErrors(address)
    setErrors(checked.errors)
    if (Object.keys(checked.errors).length) return
    const id = invoice.id, key = scope
    pendingCheckout.current = true
    setBusy(true); setError('')
    // POST is deliberately NOT aborted or automatically repeated: if transport
    // fails after dispatch, the provider session may already exist.
    let redirecting = false
    try {
      const result = await createPayMongoCheckout(id, checked.address ? { billing_address: checked.address, save_billing_address: save } : {})
      if (!owns(key)) return
      if (result.ok && result.data?.checkout_url) { window.location.href = result.data.checkout_url; redirecting = true; return }
      if (result.kind === 'validation') setErrors(Object.fromEntries(Object.entries(result.errors || {}).map(([k, v]) => [k.replace('billing_address.', ''), Array.isArray(v) ? v[0] : String(v)])))
      setError(['network', 'stale_context'].includes(result.kind) || result.ok
        ? 'Checkout status could not be confirmed. Return to invoices and refresh before trying again.'
        : result.message || 'The checkout was refused. Refresh the invoice before trying again.')
    } catch {
      if (owns(key)) setError('Checkout status could not be confirmed. Return to invoices and refresh before trying again.')
    } finally {
      // Stay disabled while the browser follows the server-issued checkout URL.
      if (!redirecting) {
        pendingCheckout.current = false
        if (live.current) setBusy(false)
      }
    }
  }

  const methods = options?.methods || []
  const hmo = Number(invoice.hmoCoverage || 0) > 0
  return <section className="rp" aria-labelledby="rp-title">
    <header className="rp-band">
      <span className="rp-logo"><img src={clinic.logo} alt="" width="40" height="40"/></span>
      <span className="rp-name"><strong>{clinic.nameLine}</strong><small>{clinic.subtitle}</small></span>
      {invoice.branch && <span className="rp-branch">{invoice.branch}</span>}
    </header>
    <div className="rp-body">
      <p className="rp-eyebrow"><span className="rp-badge">{payable ? 'Payment due' : 'Invoice status changed'}</span></p>
      <h1 id="rp-title" className="rp-title">Review and pay</h1>
      <p className="rp-sub">Invoice <b>{invoice.invoiceNo}</b>{invoice.date ? ` · Issued ${dateLabel(invoice.date)}` : ''}{invoice.branch ? ` · ${invoice.branch}` : ''}</p>

      <div className="rp-hero"><span>{payable ? 'Amount due' : 'Latest reported balance'}</span><b>{money(invoice.balance)}</b></div>

      <ul className="rp-items" aria-label="Itemized charges">
        {invoice.items.map(item => <li key={item.key}><span><b>{item.name}</b><small>{item.quantity} × {money(item.unit)}</small></span><span>{money(item.amount)}</span></li>)}
        <li className="rp-sum"><span>Subtotal</span><span>{money(invoice.total)}</span></li>
        {Number(invoice.discountAmount || 0) > 0 && <li className="rp-sum"><span>Less: 20% {invoice.discountType || 'Statutory'} discount{invoice.discountIdNumber ? ` (${invoice.discountIdNumber})` : ''}</span><span>−{money(invoice.discountAmount)}</span></li>}
        {hmo && <li className="rp-sum"><span>Less: coverage</span><span>−{money(invoice.hmoCoverage)}</span></li>}
        <li className="rp-total"><span>Total</span><span>{money(invoice.patientResponsibility ?? invoice.total)}</span></li>
      </ul>

      {!payable ? <Notice tone="warning" title="Review the latest invoice">This invoice is no longer confirmed as payable. Return to invoices and refresh before starting another checkout.</Notice>
        : optionsError ? <div role="alert"><Notice tone="warning" title="Online payment unavailable">{optionsError}</Notice><Button type="button" size="sm" variant="soft" onClick={() => setOptionAttempt(value => value + 1)}>Retry payment options</Button></div>
        : !options ? <Notice>Loading payment options…</Notice> : methods.length === 0
        ? <Notice tone="warning" title="Online payment is not set up">The clinic has not turned on online payment. You can pay at the clinic front desk.</Notice>
        : <form className="rp-form" onSubmit={pay} noValidate>
          <fieldset>
            <legend>Billing address <small>(optional)</small></legend>
            <p className="rp-hint">Fill this in now to save time, or leave it empty and PayMongo will ask for it on the next page.</p>
            <Field label={LABELS.line1} error={errors.line1}><input value={address?.line1 || ''} onChange={set('line1')} autoComplete="address-line1" maxLength={255}/></Field>
            <Field label={LABELS.line2} error={errors.line2}><input value={address?.line2 || ''} onChange={set('line2')} autoComplete="address-line2" maxLength={255}/></Field>
            <div className="rp-grid">
              <Field label={LABELS.city} error={errors.city}><input value={address?.city || ''} onChange={set('city')} autoComplete="address-level2" maxLength={100}/></Field>
              <Field label={LABELS.state} error={errors.state}><input value={address?.state || ''} onChange={set('state')} autoComplete="address-level1" maxLength={100}/></Field>
              <Field label={LABELS.postal_code} error={errors.postal_code}><input value={address?.postal_code || ''} onChange={set('postal_code')} autoComplete="postal-code" inputMode="numeric" maxLength={20}/></Field>
              <Field label={LABELS.country} hint="PH for the Philippines" error={errors.country}><input value={address?.country || ''} onChange={set('country')} autoComplete="country" maxLength={2}/></Field>
            </div>
            {options.can_save_billing_address && <label className="rp-check"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)}/> Save this address to my profile for next time</label>}
          </fieldset>
          {error && <Notice tone="warning" title="Payment not started">{error}</Notice>}
          <Button type="submit" variant="primary" width="full" className="rp-pay" disabled={busy}>{busy ? 'Opening PayMongo…' : <>🔒&nbsp; Pay {money(invoice.balance)} securely with PayMongo</>}</Button>
          <p className="rp-note">You finish on PayMongo’s secure page. Accepted: {methods.join(', ')}. Your card or wallet details are entered on PayMongo, never on this site.</p>
        </form>}
      <Button variant="ghost" onClick={onBack}>Back to invoices</Button>
    </div>
  </section>
}
