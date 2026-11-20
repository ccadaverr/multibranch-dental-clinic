import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { paymentOptionsProjection } from '../src/payment-options-read.js'
import { startHomeRead, HomeReadDeadlineError } from '../src/home-read-deadline.js'
import { getPaymentOptions } from '../src/api-client.js'

const address = { line1: '', line2: '', city: '', state: '', postal_code: '', country: 'PH' }
const valid = { methods: ['GCash', 'Card'], can_save_billing_address: true, billing_address: address }
const view = readFileSync(new URL('../src/pages/ReviewAndPay.jsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../src/api-client.js', import.meta.url), 'utf8')

test('payment option read gate accepts the real controller payload without fabricating methods', () => {
  assert.deepEqual(paymentOptionsProjection(valid), valid)
  assert.deepEqual(paymentOptionsProjection({ ...valid, methods: [] }), { ...valid, methods: [] })
  assert.deepEqual(paymentOptionsProjection({ ...valid, billing_address: { ...address, line1: 'Typed address' } }).billing_address.line1, 'Typed address')
})

test('invalid payment methods and missing address fields cannot authorize a checkout form', () => {
  for (const bad of [null, [], {}, { ...valid, methods: null }, { ...valid, methods: [3] },
    { ...valid, methods: ['Card', 'Card'] }, { ...valid, methods: [''] },
    { ...valid, can_save_billing_address: 'true' }, { ...valid, billing_address: null },
    { ...valid, billing_address: { ...address, country: null } },
    { ...valid, billing_address: { country: 'PH' } }]) {
    assert.equal(paymentOptionsProjection(bad), null, JSON.stringify(bad))
  }
})

test('payment options use an abortable GET with no CSRF prefetch or payment write', async () => {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ data: valid }) }
  }
  try {
    const controller = new AbortController()
    assert.deepEqual(await getPaymentOptions('synthetic-invoice', controller.signal), { ok: true, data: valid })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/api/invoices/synthetic-invoice/payment-options'))
    assert.equal(calls[0].options.signal, controller.signal)
    assert.equal(calls[0].options.method, 'GET')
  } finally { globalThis.fetch = previous }
})

test('a never-settling options read aborts and ends at the finite deadline', async () => {
  let signal
  const read = startHomeRead(next => { signal = next; return new Promise(() => {}) }, {
    timeoutMs: 12, timeoutMessage: 'Payment options took too long to load. Please retry.',
  })
  await assert.rejects(read.response, error => error instanceof HomeReadDeadlineError && /too long/.test(error.message))
  assert.equal(signal.aborted, true)
})

test('changing or leaving the payment screen cancels its GET; late response never commits', async () => {
  let signal
  const request = startHomeRead(next => { signal = next; return new Promise(() => {}) }, { timeoutMs: 600 })
  // Yield once so that the read function has received its signal.
  await Promise.resolve()
  request.cancel()
  await assert.rejects(request.response, HomeReadDeadlineError)
  assert.equal(signal.aborted, true)
  assert.match(view, /if \(!active \|\| !owns\(key\)\) return/)
  assert.match(view, /return \(\) => \{ active = false; task\.cancel\(\) \}/)
  assert.match(view, /invoice\.patientId, invoice\.visitId, invoice\.appointmentId, invoice\.status, invoice\.balance/)
  assert.match(view, /optionResult\?\.scope === scope && optionResult\?\.attempt === optionAttempt/)
})

test('payment form fails closed on invalid/settled invoices, retries read, and keeps address edits', () => {
  assert.match(view, /invoice\.status === 'Issued' && moneyMinor\(invoice\.balance\) > 0/)
  assert.match(view, /if \(!payable\) return undefined/)
  assert.match(view, /!payable \? <Notice/)
  assert.match(view, /Retry payment options/)
  assert.match(view, /setOptionAttempt\(value => value \+ 1\)/)
  assert.match(view, /setAddressState\(previous => previous\?\.id === id \? previous/)
  assert.match(view, /disabled=\{busy\}/)
})

test('only explicit patient submit posts; never invent an amount, checkout URL or paid status', () => {
  assert.match(view, /const pay = async event => \{/)
  assert.match(view, /pendingCheckout\.current = true/)
  assert.match(view, /const result = await createPayMongoCheckout\(id, checked\.address \?/)
  assert.match(view, /if \(result\.ok && result\.data\?\.checkout_url\) \{ window\.location\.href = result\.data\.checkout_url; redirecting = true; return \}/)
  assert.match(view, /if \(!redirecting\) \{/)
  assert.doesNotMatch(view, /success_url|cancel_url|status:\s*'Paid'|amount_php/)
  assert.match(view, /Checkout status could not be confirmed\. Return to invoices and refresh before trying again\./)
  assert.match(api, /export function createPayMongoCheckout/)
})
