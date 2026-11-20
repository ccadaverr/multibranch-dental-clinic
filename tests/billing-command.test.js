import test from 'node:test'
import assert from 'node:assert/strict'
import { billingReceiptMatches, createBillingCommand, moneyMinor, confirmedBillingReceipt } from '../src/billing-command.js'
const base = { id: 'invoice', invoice_number: 'INV-1', revision: 3, status: 'Issued', patient: { id: 'patient' }, branch: { id: 'branch' }, treatment_id: 'treatment', visit_id: 'visit', gross_amount: '125.50', patient_responsibility_amount: '125.50', paid_amount: '0.00', balance: '125.50', lines: [{ id: 'line', service: { id: 'service' }, service_price_id: 'price', quantity: 1, unit_price: '125.50', line_total: '125.50' }] }
const intent = () => ({ mode: 'payment', base: structuredClone(base), payload: { expected_revision: 3, method: 'Cash', amount: '125.50', external_reference: null } })
const paid = () => ({ ...structuredClone(base), revision: 4, status: 'Paid', balance: '0.00', paid_amount: '125.50', paid_at: '2026-11-15T10:00:00+08:00', payment: { id: 'payment', amount: '125.50', method: 'Cash', external_reference: null, recorded_at: '2026-11-15T10:00:00+08:00' }, receipt: { id: 'receipt', number: 'RCT-1', amount: '125.50', method: 'Cash', external_reference: null, issued_at: '2026-11-15T10:00:00+08:00' } })
const later = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
test('money comparison uses exact minor units and refuses malformed/unsafe values', () => {
  assert.equal(moneyMinor('125.50'), 12550); assert.equal(moneyMinor('0.1'), 10)
  for (const value of [125.5, '', '-1.00', '1.001', 'NaN', '900719925474099.99']) assert.equal(moneyMinor(value), null)
})
test('a settlement requires exact identity, original charge snapshots, revision, amount, method and persisted evidence', () => {
  assert.equal(billingReceiptMatches(intent(), paid()), true)
  for (const mutate of [r => r.id = 'other', r => r.patient.id = 'other', r => r.branch.id = 'other', r => r.visit_id = 'other', r => r.treatment_id = 'other', r => r.revision = 3, r => r.status = 'Issued', r => r.balance = '0.01', r => r.paid_amount = '0.00', r => r.patient_responsibility_amount = '999.00', r => r.payment = null, r => r.receipt = null, r => r.receipt.number = '', r => r.receipt.method = 'Card/POS', r => r.receipt.amount = '999.00', r => r.receipt.external_reference = 'other', r => r.payment.amount = '999.00', r => r.lines[0].unit_price = '999.00']) {
    const row = paid(); mutate(row); assert.equal(billingReceiptMatches(intent(), row), false)
  }
})
test('same-tick duplicates are latched and success is withheld until exact authoritative readback', async () => {
  const sent = later(), read = later(); let sends = 0
  const c = createBillingCommand({ key: () => 'one', send: () => { sends++; return sent.promise }, read: () => read.promise })
  const result = c.run(intent()); assert.equal((await c.run(intent())).ignored, true); assert.equal(sends, 1)
  sent.resolve({ ok: true, data: paid() }); await new Promise(r => setImmediate(r)); assert.equal(c.state().pending, true)
  read.resolve({ ok: true, data: paid() }); assert.equal((await result).ok, true); assert.equal(c.state().intent, null)
})
test('lost response retries the immutable payload and same key, with no second collection', async () => {
  const sent = []; let keys = 0
  const c = createBillingCommand({ key: () => `key-${++keys}`, send: async i => { sent.push(structuredClone(i)); return sent.length === 1 ? { ok: false, kind: 'network' } : { ok: true, data: paid() } }, read: async () => ({ ok: true, data: paid() }) })
  const source = intent(); assert.equal((await c.run(source)).ok, false); source.payload.amount = '999.00'
  assert.equal((await c.run(intent())).ignored, true)
  assert.equal((await c.run()).ok, true); assert.deepEqual(sent[0], sent[1]); assert.equal(keys, 1)
})
test('contradictory receipts and older/failed readbacks never become a successful collection', async () => {
  for (const result of [{ ok: true, data: { ...paid(), id: 'other' } }, { ok: true, data: paid() }]) {
    const c = createBillingCommand({ key: () => 'one', send: async () => result, read: async () => ({ ok: true, data: base }) })
    assert.equal((await c.run(intent())).kind, 'unconfirmed'); assert.ok(c.state().intent)
  }
})
test('auth changes/unmount during the request suppress readback and publication', async () => {
  for (const dispose of [false, true]) {
    const request = later(); let allowed = true, reads = 0, publications = 0
    const c = createBillingCommand({ key: () => 'one', allowed: () => allowed, send: () => request.promise, read: () => { reads++; return { ok: true, data: paid() } }, publish: () => publications++ })
    const run = c.run(intent()); dispose ? c.dispose() : allowed = false
    request.resolve({ ok: true, data: paid() }); assert.equal((await run).ignored, true); assert.equal(reads, 0); assert.equal(publications, 1)
  }
})
test('definitive validation preserves editable form opportunity; conflict retains its journal intent', async () => {
  for (const kind of ['validation', 'conflict']) {
    const c = createBillingCommand({ key: () => 'one', send: async () => ({ ok: false, kind }), read: async () => ({}) })
    await c.run(intent()); assert.equal(!!c.state().intent, kind === 'conflict')
  }
})

test('Patient receipt availability requires concordant stored payment evidence', () => {
  assert.equal(confirmedBillingReceipt(paid()),true)
  for (const mutate of [r=>r.status='Issued',r=>r.payment=null,r=>r.receipt.amount='1.00',r=>r.receipt.external_reference='other',r=>r.balance='0.01',r=>r.paid_at=null,r=>{r.receipt.amount='999.00';r.payment.amount='999.00'},r=>{r.receipt.method='';r.payment.method=''}]) {
    const row=paid();mutate(row);assert.equal(confirmedBillingReceipt(row),false)
  }
})

test('Cash correction acknowledgement refers to the original immutable receipt and cannot imply a refund', () => {
  const original = { ...paid(), refund_status: 'none' }
  const request = { mode: 'cashReview', base: original, payload: { expected_revision: 4, reason: 'suspected_duplicate' } }
  const review = { ...original, revision: 5, cash_correction: {
    status: 'requested', reason: 'suspected_duplicate', occurred_at: original.paid_at,
  } }
  assert.equal(billingReceiptMatches(request, review), true)
  assert.equal(billingReceiptMatches(request, { ...review, refund_status: 'refunded' }), false)
  assert.equal(billingReceiptMatches(request, { ...review, receipt: { ...review.receipt, id: 'other' } }), false)
  const acknowledge = { mode: 'ackCashReview', base: review, payload: { expected_revision: 5 } }
  const result = { ...review, revision: 6, cash_correction: { ...review.cash_correction, status: 'acknowledged' } }
  assert.equal(billingReceiptMatches(acknowledge, result), true)
  assert.equal(billingReceiptMatches(acknowledge, { ...result, cash_correction: { ...result.cash_correction, reason: 'refund_requested' } }), false)
})
